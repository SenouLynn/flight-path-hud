// Package contractpath resolves checked-in evidence independently of caller cwd.
package contractpath

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Find walks upward from the executable module source location until relative exists.
func Find(relative string) (string, error) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("resolve contract path: caller unavailable")
	}
	for directory := filepath.Dir(source); ; directory = filepath.Dir(directory) {
		candidate := filepath.Join(directory, relative)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", fmt.Errorf("resolve contract path %q: repository root not found", relative)
		}
	}
}
