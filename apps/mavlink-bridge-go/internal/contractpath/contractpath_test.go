package contractpath

import (
	"os"
	"testing"
)

func TestFindDoesNotDependOnWorkingDirectory(t *testing.T) {
	original, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(original) })
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	path, err := Find("contracts/semantics/bridge-core-schedule.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
