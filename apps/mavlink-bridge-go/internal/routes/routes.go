// Package routes provides pure exact-target route state. It opens no sockets.
package routes

import "sort"

type Target struct {
	SysID  uint8
	CompID uint8
}

type route struct {
	source     string
	lastSeenMs float64
}

type Table struct {
	routes map[Target]route
}

func New() *Table {
	return &Table{routes: make(map[Target]route)}
}

func (t *Table) Remember(target Target, source string, atMs float64) {
	t.routes[target] = route{source: source, lastSeenMs: atMs}
}

func (t *Table) SourceFor(target Target) (string, bool) {
	value, ok := t.routes[target]
	return value.source, ok
}

func (t *Table) Sources() []string {
	unique := make(map[string]struct{})
	for _, value := range t.routes {
		unique[value.source] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for source := range unique {
		result = append(result, source)
	}
	sort.Strings(result)
	return result
}

// Expire preserves a route at exactly maxAgeMs, matching the Node strict > boundary.
func (t *Table) Expire(maxAgeMs, nowMs float64) {
	for target, value := range t.routes {
		if nowMs-value.lastSeenMs > maxAgeMs {
			delete(t.routes, target)
		}
	}
}
