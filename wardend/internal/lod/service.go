package lod

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/bus"
	"github.com/manuelvega/warden/wardend/internal/mc"
)

// PollInterval is how often a running pre-generation's status is asked.
const PollInterval = 5 * time.Second

// EvPregenDone is the activity event recorded when a pre-generation finishes.
const EvPregenDone mc.EventKind = "lod.pregen.done"

// Host is one instance, as the service needs it (satisfied by *instance.Instance).
type Host interface {
	Running() (bool, time.Time)
	LOD() Settings
	UpdateLOD(func(*Settings)) error
}

// Hosts finds instances.
type Hosts interface {
	Host(id string) (Host, bool)
	IDs() []string
}

// Runner runs a plugin command on an instance and returns its reply (satisfied by *world.Service).
type Runner interface {
	Run(ctx context.Context, instanceID, command string) ([]string, error)
}

// EventSink records activity events (the store).
type EventSink interface {
	OnEvent(instanceID string, ev *mc.Event, at time.Time)
}

// PregenState is a recorded pre-generation with its last known status.
type PregenState struct {
	Pregen
	Status PregenStatus `json:"status"`
}

// Service keeps DHS pre-generations going (ADR-025): starts and stops them, asks their status every
// PollInterval while the server runs, broadcasts it, and relaunches one that a restart cut short.
type Service struct {
	hosts  Hosts
	run    Runner
	bc     bus.Broadcaster
	events EventSink
	mu     sync.Mutex
	last   map[string]map[string]PregenStatus // instance → world → last status
}

func NewService(hosts Hosts, run Runner, bc bus.Broadcaster, events EventSink) *Service {
	return &Service{hosts: hosts, run: run, bc: bc, events: events, last: map[string]map[string]PregenStatus{}}
}

// ErrNotRunning: pre-generation needs the server running.
var ErrNotRunning = errors.New("the server is not running")

func startCommand(p Pregen) string {
	cmd := "dhs pregen start " + WorldArg(p.World)
	if p.X != nil && p.Z != nil {
		cmd += " " + strconv.Itoa(*p.X) + " " + strconv.Itoa(*p.Z)
	}
	if p.Radius != nil {
		cmd += " " + strconv.Itoa(*p.Radius)
	}
	return cmd
}

// Start launches a pre-generation and records it, replacing a recorded one for the same world.
func (s *Service) Start(ctx context.Context, id string, p Pregen) error {
	h, ok := s.hosts.Host(id)
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}
	running, since := h.Running()
	if !running {
		return ErrNotRunning
	}
	lines, err := s.run.Run(ctx, id, startCommand(p))
	if err != nil {
		return err
	}
	if err := PregenStarted(lines); err != nil {
		return err
	}
	p.StartedAt, p.Session, p.ResumedAt = time.Now().UTC(), since, nil
	return h.UpdateLOD(func(st *Settings) {
		st.Pregens = append(without(st.Pregens, p.World), p)
	})
}

// Stop stops a pre-generation and forgets it.
func (s *Service) Stop(ctx context.Context, id, world string) error {
	h, ok := s.hosts.Host(id)
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}
	if running, _ := h.Running(); running {
		if _, err := s.run.Run(ctx, id, "dhs pregen stop "+WorldArg(world)); err != nil {
			return err
		}
	}
	// The record goes first: a poll in flight reports its world only while it is still recorded
	// (rememberRecorded), so it cannot bring a stopped pre-generation back after the lines below.
	err := h.UpdateLOD(func(st *Settings) { st.Pregens = without(st.Pregens, world) })
	s.mu.Lock()
	delete(s.last[id], world)
	s.broadcast(id, world, "stopped", PregenStatus{})
	s.mu.Unlock()
	return err
}

// States are the instance's recorded pre-generations with their last known status.
func (s *Service) States(id string) []PregenState {
	h, ok := s.hosts.Host(id)
	if !ok {
		return nil
	}
	pregens := h.LOD().Pregens
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []PregenState
	for _, p := range pregens {
		out = append(out, PregenState{Pregen: p, Status: s.last[id][p.World]})
	}
	return out
}

// Run polls every PollInterval until ctx ends.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Poll(ctx)
		}
	}
}

// Poll asks the status of every recorded pre-generation on a running server, once.
func (s *Service) Poll(ctx context.Context) {
	for _, id := range s.hosts.IDs() {
		h, ok := s.hosts.Host(id)
		if !ok {
			continue
		}
		running, since := h.Running()
		if !running {
			continue
		}
		for _, p := range h.LOD().Pregens {
			s.pollOne(ctx, id, h, p, since)
		}
	}
}

func (s *Service) pollOne(ctx context.Context, id string, h Host, p Pregen, since time.Time) {
	qctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	lines, err := s.run.Run(qctx, id, "dhs pregen status "+WorldArg(p.World))
	if err != nil {
		return // no agent yet (the server is starting), or busy: ask again next round
	}
	st := ParsePregenStatus(lines)
	switch st.State {
	case "done":
		s.forget(id, p.World)
		s.broadcast(id, p.World, "done", st)
		_ = h.UpdateLOD(func(set *Settings) { set.Pregens = without(set.Pregens, p.World) })
		if s.events != nil {
			ev := &mc.Event{Kind: EvPregenDone, Text: "LOD pre-generation of " + p.World + " finished"}
			now := time.Now().UTC()
			s.events.OnEvent(id, ev, now)
			s.bc.Broadcast(id, "event", ev.Payload(now))
		}
	case "none":
		if since.After(p.Session) {
			// The server started again since it was launched: carry on where it was.
			if err := s.relaunch(ctx, id, h, p, since); err != nil {
				slog.Warn("resume LOD pre-generation", "instance", id, "world", p.World, "err", err)
			}
			return
		}
		// Same server session and nothing running: it was stopped from the console.
		s.forget(id, p.World)
		s.broadcast(id, p.World, "stopped", st)
		_ = h.UpdateLOD(func(set *Settings) { set.Pregens = without(set.Pregens, p.World) })
	default: // running | unknown
		s.rememberRecorded(id, h, p.World, st)
	}
}

// rememberRecorded keeps and broadcasts a status only while its pre-generation is still recorded:
// Stop may have removed it while the status was being asked. Checked and applied under s.mu, which
// Stop holds for its own forget and broadcast after removing the record.
func (s *Service) rememberRecorded(id string, h Host, world string, st PregenStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !slices.ContainsFunc(h.LOD().Pregens, func(p Pregen) bool { return strings.EqualFold(p.World, world) }) {
		return
	}
	if s.last[id] == nil {
		s.last[id] = map[string]PregenStatus{}
	}
	s.last[id][world] = st
	s.broadcast(id, world, st.State, st)
}

func (s *Service) relaunch(ctx context.Context, id string, h Host, p Pregen, since time.Time) error {
	lines, err := s.run.Run(ctx, id, startCommand(p))
	if err != nil {
		return err
	}
	if err := PregenStarted(lines); err != nil {
		return err
	}
	now := time.Now().UTC()
	s.broadcast(id, p.World, "resumed", PregenStatus{})
	return h.UpdateLOD(func(set *Settings) {
		for i := range set.Pregens {
			if set.Pregens[i].World == p.World {
				set.Pregens[i].Session, set.Pregens[i].ResumedAt = since, &now
			}
		}
	})
}

func (s *Service) forget(id, world string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.last[id], world)
}

func (s *Service) broadcast(id, world, state string, st PregenStatus) {
	d := map[string]any{"world": world, "state": state, "progress": st.Progress, "done": st.Done,
		"target": st.Target, "cps": st.CPS, "elapsed": st.Elapsed, "remaining": st.Remaining}
	if len(st.Raw) > 0 {
		d["raw"] = st.Raw
	}
	s.bc.Broadcast(id, "lod.pregen", d)
}

func without(ps []Pregen, world string) []Pregen {
	out := ps[:0:0]
	for _, p := range ps {
		if !strings.EqualFold(p.World, world) {
			out = append(out, p)
		}
	}
	return out
}
