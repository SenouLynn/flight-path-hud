package bridge

import (
	"sort"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/mavlink"
)

type MessageRate struct {
	MessageName string `json:"messageName"`
	RateHz      int    `json:"rateHz"`
}
type System struct {
	SysID               byte    `json:"sysId"`
	CompID              byte    `json:"compId"`
	LastSeenTimestampMs float64 `json:"lastSeenTimestampMs"`
}
type Health struct {
	PacketRateHz       int           `json:"packetRateHz"`
	DecodeErrorCount   int           `json:"decodeErrorCount"`
	DroppedPacketCount int           `json:"droppedPacketCount"`
	MessageRates       []MessageRate `json:"messageRates"`
	Systems            []System      `json:"systems"`
}
type OutputEnvelope struct {
	mavlink.Envelope
	Health Health `json:"health"`
}
type SourceConflict struct {
	System  string   `json:"system"`
	Sources []string `json:"sources"`
}

type Core struct {
	ttl                                                       float64
	packetCount, decodeErrors, dropped, sinceTick, packetRate int
	counts                                                    map[string]int
	rates                                                     []MessageRate
	systems                                                   map[string]System
	sources                                                   map[string][]string
	conflicts                                                 []SourceConflict
}

func New(systemTTL float64) *Core {
	return &Core{ttl: systemTTL, counts: map[string]int{}, rates: []MessageRate{}, systems: map[string]System{}, sources: map[string][]string{}}
}
func key(sys, comp byte) string { return itoa(int(sys)) + ":" + itoa(int(comp)) }
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	b := make([]byte, 0, 3)
	for value > 0 {
		b = append([]byte{byte('0' + value%10)}, b...)
		value /= 10
	}
	return string(b)
}

func (c *Core) Ingest(raw []byte, atMs float64, source string) []OutputEnvelope {
	envelopes, decodeErrors := mavlink.ParseDatagram(raw, atMs)
	c.decodeErrors += decodeErrors
	c.dropped += decodeErrors
	outputs := make([]OutputEnvelope, 0, len(envelopes))
	for _, envelope := range envelopes {
		c.packetCount++
		c.sinceTick++
		c.counts[envelope.MessageName]++
		identity := key(envelope.SysID, envelope.CompID)
		if source != "" {
			seen := c.sources[identity]
			found := false
			for _, s := range seen {
				if s == source {
					found = true
				}
			}
			if !found {
				seen = append(seen, source)
				c.sources[identity] = seen
				if len(seen) > 1 {
					c.conflicts = append(c.conflicts, SourceConflict{identity, append([]string(nil), seen...)})
				}
			}
		}
		c.systems[identity] = System{envelope.SysID, envelope.CompID, atMs}
		if envelope.Sequence == 0 {
			envelope.Sequence = byte(c.packetCount % 256)
		}
		outputs = append(outputs, OutputEnvelope{envelope, c.health()})
	}
	return outputs
}
func (c *Core) health() Health {
	systems := make([]System, 0, len(c.systems))
	for _, s := range c.systems {
		systems = append(systems, s)
	}
	sort.Slice(systems, func(i, j int) bool {
		if systems[i].SysID != systems[j].SysID {
			return systems[i].SysID < systems[j].SysID
		}
		return systems[i].CompID < systems[j].CompID
	})
	rates := make([]MessageRate, len(c.rates))
	copy(rates, c.rates)
	return Health{c.packetRate, c.decodeErrors, c.dropped, rates, systems}
}
func (c *Core) Tick(atMs float64) {
	c.packetRate = c.sinceTick
	c.sinceTick = 0
	c.rates = c.rates[:0]
	for name, count := range c.counts {
		c.rates = append(c.rates, MessageRate{name, count})
	}
	sort.Slice(c.rates, func(i, j int) bool {
		if c.rates[i].RateHz != c.rates[j].RateHz {
			return c.rates[i].RateHz > c.rates[j].RateHz
		}
		return c.rates[i].MessageName < c.rates[j].MessageName
	})
	clear(c.counts)
	staleBefore := atMs - c.ttl
	for k, s := range c.systems {
		if s.LastSeenTimestampMs < staleBefore {
			delete(c.systems, k)
			delete(c.sources, k)
		}
	}
}
func (c *Core) TakeConflicts() []SourceConflict {
	result := append([]SourceConflict(nil), c.conflicts...)
	c.conflicts = c.conflicts[:0]
	return result
}
func (c *Core) SystemCount() int { return len(c.systems) }
