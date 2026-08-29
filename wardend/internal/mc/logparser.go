package mc

import (
	"regexp"
	"strings"
)

// EventKind enumerates the events the daemon extracts from the server stdout.
type EventKind string

const (
	EvServerReady      EventKind = "server.ready"
	EvServerStopping   EventKind = "server.stopping"
	EvServerOverloaded EventKind = "server.overloaded"
	EvPlayerJoin       EventKind = "player.join"
	EvPlayerLeave      EventKind = "player.leave"
	EvPlayerChat       EventKind = "player.chat"
	EvPlayerAdvance    EventKind = "player.advancement"
)

type Event struct {
	Kind   EventKind
	Player string
	Text   string
}

// Prefixes: Paper "[12:00:01 INFO]: " and vanilla "[12:00:01] [Server thread/INFO]: ".
var prefixRe = regexp.MustCompile(`^\[\d{2}:\d{2}:\d{2}(?: [A-Z]+)?\](?: \[[^\]]+\])?: `)

var (
	readyRe   = regexp.MustCompile(`^Done \([\d.]+s\)! For help, type "help"`)
	joinRe    = regexp.MustCompile(`^(\S+) joined the game$`)
	leaveRe   = regexp.MustCompile(`^(\S+) left the game$`)
	chatRe    = regexp.MustCompile(`^<(\S+)> (.*)$`)
	advanceRe = regexp.MustCompile(`^(\S+) has (?:made the advancement|completed the challenge|reached the goal) \[(.+)\]$`)
	overRe    = regexp.MustCompile(`^Can't keep up!`)
)

// Parse returns the event contained in a log line, or nil.
func Parse(line string) *Event {
	body := prefixRe.ReplaceAllString(strings.TrimRight(line, "\r\n"), "")
	switch {
	case readyRe.MatchString(body):
		return &Event{Kind: EvServerReady, Text: body}
	case body == "Stopping the server" || body == "Stopping server":
		return &Event{Kind: EvServerStopping, Text: body}
	case overRe.MatchString(body):
		return &Event{Kind: EvServerOverloaded, Text: body}
	}
	if m := joinRe.FindStringSubmatch(body); m != nil {
		return &Event{Kind: EvPlayerJoin, Player: m[1], Text: body}
	}
	if m := leaveRe.FindStringSubmatch(body); m != nil {
		return &Event{Kind: EvPlayerLeave, Player: m[1], Text: body}
	}
	if m := chatRe.FindStringSubmatch(body); m != nil {
		return &Event{Kind: EvPlayerChat, Player: m[1], Text: m[2]}
	}
	if m := advanceRe.FindStringSubmatch(body); m != nil {
		return &Event{Kind: EvPlayerAdvance, Player: m[1], Text: m[2]}
	}
	return nil
}
