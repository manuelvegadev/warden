package metrics

import "time"

// Bucket reduces a series to one sample per `step`, aligned to the epoch and stamped with the
// start of its step: CPU, memory, network and TPS averaged by how many samples each input stands
// for, with the peak CPU and memory and the lowest TPS kept beside the averages, so a spike
// survives the reduction; players and disk take the step's highest. A step without samples is
// left out, so a server that was stopped stays a gap. Samples must be oldest first.
func Bucket(samples []Sample, step time.Duration) []Sample {
	sec := int64(step / time.Second)
	if sec <= 0 || len(samples) == 0 {
		return samples
	}
	type acc struct {
		start                 int64
		n, tpsN               float64
		cpu, mem, rx, tx, tps float64
		cpuMax, tpsMin        float64
		memMax, memCap, disk  int64
		players               int
		hasTPS                bool
	}
	var out []Sample
	var cur *acc
	flush := func() {
		if cur == nil {
			return
		}
		cpuMax, memMax := cur.cpuMax, cur.memMax
		b := Sample{
			TS:        time.Unix(cur.start, 0).UTC(),
			CPU:       cur.cpu / cur.n,
			MemRSS:    int64(cur.mem / cur.n),
			MemMax:    cur.memCap,
			DiskUsed:  cur.disk,
			Players:   cur.players,
			NetRx:     int64(cur.rx / cur.n),
			NetTx:     int64(cur.tx / cur.n),
			CPUMax:    &cpuMax,
			MemRSSMax: &memMax,
		}
		if cur.hasTPS {
			tpsMin := cur.tpsMin
			b.TPS = &[3]float64{cur.tps / cur.tpsN, 0, 0}
			b.TPSMin = &tpsMin
		}
		out = append(out, b)
	}
	for _, s := range samples {
		start := s.TS.Unix() / sec * sec
		if cur == nil || cur.start != start {
			flush()
			cur = &acc{start: start}
		}
		w := float64(s.Weight())
		cur.n += w
		cur.cpu += s.CPU * w
		cur.mem += float64(s.MemRSS) * w
		cur.rx += float64(s.NetRx) * w
		cur.tx += float64(s.NetTx) * w
		cur.cpuMax = max(cur.cpuMax, deref(s.CPUMax, s.CPU))
		cur.memMax = max(cur.memMax, deref(s.MemRSSMax, s.MemRSS))
		cur.disk = max(cur.disk, s.DiskUsed)
		cur.players = max(cur.players, s.Players)
		if s.MemMax > 0 {
			cur.memCap = s.MemMax
		}
		if s.TPS != nil {
			low := deref(s.TPSMin, s.TPS[0])
			if !cur.hasTPS || low < cur.tpsMin {
				cur.tpsMin = low
			}
			cur.hasTPS = true
			cur.tpsN += w
			cur.tps += s.TPS[0] * w
		}
	}
	flush()
	return out
}

func deref[T any](p *T, fallback T) T {
	if p != nil {
		return *p
	}
	return fallback
}
