package routes

import "testing"

func TestExactTargetAndExpiry(t *testing.T) {
	table := New()
	copter := Target{SysID: 1, CompID: 1}
	plane := Target{SysID: 2, CompID: 1}
	table.Remember(copter, "copter", 10)
	table.Remember(plane, "plane", 20)
	if got, _ := table.SourceFor(copter); got != "copter" {
		t.Fatalf("copter route = %q", got)
	}
	if _, ok := table.SourceFor(Target{SysID: 9, CompID: 1}); ok {
		t.Fatal("unknown target fell back to another source")
	}
	table.Expire(10, 30)
	if _, ok := table.SourceFor(plane); !ok {
		t.Fatal("equal-threshold route expired")
	}
	table.Expire(10, 31)
	if _, ok := table.SourceFor(plane); ok {
		t.Fatal("stale route retained")
	}
}

func TestRememberUpdatesOnlyExactTargetAndSourcesDeduplicate(t *testing.T) {
	table := New()
	table.Remember(Target{1, 1}, "shared", 1)
	table.Remember(Target{2, 1}, "shared", 2)
	table.Remember(Target{1, 1}, "new", 3)
	if got, _ := table.SourceFor(Target{2, 1}); got != "shared" {
		t.Fatalf("peer route changed to %q", got)
	}
	got := table.Sources()
	if len(got) != 2 || got[0] != "new" || got[1] != "shared" {
		t.Fatalf("sources = %#v", got)
	}
}
