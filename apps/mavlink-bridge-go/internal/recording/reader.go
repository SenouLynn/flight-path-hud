// Package recording reads finite JSONL captures and dispatches them passively.
package recording

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type Entry struct {
	TMs   float64
	AtMs  float64
	Data  []byte
	Event json.RawMessage
}

type wireEntry struct {
	TMs    float64         `json:"tMs"`
	AtMs   float64         `json:"atMs"`
	Base64 *string         `json:"base64"`
	Event  json.RawMessage `json:"event"`
}

func Read(reader io.Reader) ([]Entry, error) {
	buffered := bufio.NewReader(reader)
	entries := make([]Entry, 0)
	lineNumber := 0
	for {
		line, err := buffered.ReadBytes('\n')
		if len(line) > 0 {
			lineNumber++
			line = bytes.TrimSpace(line)
			if len(line) > 0 {
				entry, decodeErr := decodeLine(line)
				if decodeErr != nil {
					return nil, fmt.Errorf("recording line %d: %w", lineNumber, decodeErr)
				}
				entries = append(entries, entry)
			}
		}
		if err == io.EOF {
			return entries, nil
		}
		if err != nil {
			return nil, fmt.Errorf("read recording: %w", err)
		}
	}
}

func ReadFile(path string) ([]Entry, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return Read(file)
}

func decodeLine(line []byte) (Entry, error) {
	var wire wireEntry
	if err := json.Unmarshal(line, &wire); err != nil {
		return Entry{}, err
	}
	entry := Entry{TMs: wire.TMs, AtMs: wire.AtMs}
	if wire.Base64 != nil {
		decoded, err := base64.StdEncoding.DecodeString(*wire.Base64)
		if err != nil {
			return Entry{}, fmt.Errorf("decode base64: %w", err)
		}
		entry.Data = append([]byte(nil), decoded...)
	}
	if len(wire.Event) > 0 && !bytes.Equal(wire.Event, []byte("null")) {
		entry.Event = append(json.RawMessage(nil), wire.Event...)
	}
	return entry, nil
}

// Replay is finite and unpaced. Its API deliberately has no send/start/loop method.
type Replay struct {
	entries []Entry
}

func NewReplay(entries []Entry) Replay {
	owned := make([]Entry, len(entries))
	for index, entry := range entries {
		owned[index] = entry
		owned[index].Data = append([]byte(nil), entry.Data...)
		owned[index].Event = append(json.RawMessage(nil), entry.Event...)
	}
	return Replay{entries: owned}
}

func (r Replay) Dispatch(onDatagram func([]byte, float64) error, onEvent func(json.RawMessage, float64) error) error {
	for _, entry := range r.entries {
		if entry.Data != nil {
			if err := onDatagram(append([]byte(nil), entry.Data...), entry.AtMs); err != nil {
				return err
			}
		}
		if entry.Event != nil {
			if err := onEvent(append(json.RawMessage(nil), entry.Event...), entry.AtMs); err != nil {
				return err
			}
		}
	}
	return nil
}
