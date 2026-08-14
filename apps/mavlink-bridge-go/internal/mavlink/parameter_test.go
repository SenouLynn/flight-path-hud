package mavlink

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/senoulynn/flight-path-hud/apps/mavlink-bridge-go/internal/contractpath"
)

type parameterVectors struct {
	Source  Identity `json:"source"`
	Vectors []struct {
		CaseID    string   `json:"caseId"`
		MessageID byte     `json:"messageId"`
		CRCExtra  byte     `json:"crcExtra"`
		Target    Identity `json:"target"`
		Selector  struct {
			Name  *string `json:"name"`
			Index *int    `json:"index"`
			List  bool    `json:"list"`
		} `json:"selector"`
		PayloadHex string `json:"payloadHex"`
	} `json:"vectors"`
}

func TestParameterPayloadVectors(t *testing.T) {
	path, err := contractpath.Find("contracts/mavlink/parameter-command-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture parameterVectors
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, vector := range fixture.Vectors {
		t.Run(vector.CaseID, func(t *testing.T) {
			want, err := hex.DecodeString(vector.PayloadHex)
			if err != nil {
				t.Fatal(err)
			}
			var got []byte
			if vector.Selector.List {
				got = EncodeParameterRequestListPayload(vector.Target)
			} else {
				got, err = EncodeParameterRequestReadPayload(vector.Target, vector.Selector.Name, vector.Selector.Index)
				if err != nil {
					t.Fatal(err)
				}
			}
			if hex.EncodeToString(got) != vector.PayloadHex || string(got) != string(want) {
				t.Fatalf("payload = %x, want %x", got, want)
			}
		})
	}
}

func TestCRCPrimitiveAndFullFrames(t *testing.T) {
	crc := uint16(0xffff)
	for _, value := range []byte("123456789") {
		crc = CRCAccumulate(value, crc)
	}
	if crc != 0x6f91 {
		t.Fatalf("published check CRC = %04x", crc)
	}
	name := "ARSPD_FBW_MIN"
	frame, err := EncodeParameterRequestRead(DefaultGCSIdentity, Identity{2, 1}, &name, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(frame); got != "fe1401ffbe14ffff020141525350445f4642575f4d494e0000002b2b" {
		t.Fatalf("full read frame = %s", got)
	}
	list := EncodeParameterRequestList(DefaultGCSIdentity, Identity{2, 1}, 3)
	if got := hex.EncodeToString(list); got != "fe0203ffbe1502017370" {
		t.Fatalf("full list frame = %s", got)
	}
}

func TestReadSelectorValidation(t *testing.T) {
	target := Identity{1, 1}
	badIndex := -1
	if _, err := EncodeParameterRequestReadPayload(target, nil, &badIndex); err == nil {
		t.Fatal("negative index accepted")
	}
	badName := "TEMP_°"
	if _, err := EncodeParameterRequestReadPayload(target, &badName, nil); err == nil {
		t.Fatal("non-ASCII name accepted")
	}
}
