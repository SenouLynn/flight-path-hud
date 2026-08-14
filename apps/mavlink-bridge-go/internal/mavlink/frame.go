// Package mavlink implements the bounded offline MAVLink subset used by the Go slice.
package mavlink

import "encoding/binary"

func CRCAccumulate(value byte, crc uint16) uint16 {
	temporary := value ^ byte(crc)
	temporary = (temporary ^ (temporary << 4)) & 0xff
	return (crc >> 8) ^ (uint16(temporary) << 8) ^ (uint16(temporary) << 3) ^ (uint16(temporary) >> 4)
}

func ComputeCRC(data []byte, crcExtra byte) uint16 {
	crc := uint16(0xffff)
	for _, value := range data {
		crc = CRCAccumulate(value, crc)
	}
	return CRCAccumulate(crcExtra, crc)
}

func BuildV1(messageID byte, payload []byte, sequence, sysID, compID, crcExtra byte) []byte {
	frame := make([]byte, 6+len(payload)+2)
	frame[0] = 0xfe
	frame[1] = byte(len(payload))
	frame[2] = sequence
	frame[3] = sysID
	frame[4] = compID
	frame[5] = messageID
	copy(frame[6:], payload)
	binary.LittleEndian.PutUint16(frame[6+len(payload):], ComputeCRC(frame[1:6+len(payload)], crcExtra))
	return frame
}
