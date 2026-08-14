package mavlink

import (
	"encoding/binary"
	"fmt"
)

const (
	ParamRequestReadMessageID = 20
	ParamRequestListMessageID = 21
	ParamRequestReadCRCExtra  = 214
	ParamRequestListCRCExtra  = 159
)

type Identity struct {
	SysID  uint8 `json:"sysId"`
	CompID uint8 `json:"compId"`
}

var DefaultGCSIdentity = Identity{SysID: 255, CompID: 190}

func EncodeParameterRequestReadPayload(target Identity, name *string, index *int) ([]byte, error) {
	if (name == nil) == (index == nil) {
		return nil, fmt.Errorf("specify exactly one of parameter name or index")
	}
	payload := make([]byte, 20)
	payload[2], payload[3] = target.SysID, target.CompID
	if name != nil {
		encoded := []byte(*name)
		if len(encoded) == 0 || len(encoded) > 16 {
			return nil, fmt.Errorf("parameter name must be 1-16 bytes")
		}
		for _, value := range encoded {
			if value < 0x20 || value > 0x7e {
				return nil, fmt.Errorf("parameter name must contain printable ASCII only")
			}
		}
		binary.LittleEndian.PutUint16(payload, 0xffff)
		copy(payload[4:], encoded)
		return payload, nil
	}
	if *index < 0 || *index > 32767 {
		return nil, fmt.Errorf("parameter index must be in the range 0-32767")
	}
	binary.LittleEndian.PutUint16(payload, uint16(*index))
	return payload, nil
}

func EncodeParameterRequestListPayload(target Identity) []byte {
	return []byte{target.SysID, target.CompID}
}

func EncodeParameterRequestRead(source, target Identity, name *string, index *int, sequence byte) ([]byte, error) {
	payload, err := EncodeParameterRequestReadPayload(target, name, index)
	if err != nil {
		return nil, err
	}
	return BuildV1(ParamRequestReadMessageID, payload, sequence, source.SysID, source.CompID, ParamRequestReadCRCExtra), nil
}

func EncodeParameterRequestList(source, target Identity, sequence byte) []byte {
	return BuildV1(ParamRequestListMessageID, EncodeParameterRequestListPayload(target), sequence, source.SysID, source.CompID, ParamRequestListCRCExtra)
}
