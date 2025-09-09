/** @format */

// "THE BEER-WARE LICENSE" (Revision 42):
// <me@seq.wtf> wrote this file.
// As long as you retain this notice you can do whatever you want with this stuff.
// If we meet some day, and you think this stuff is worth it, you can buy me a beer in return.
// - James

const { parentPort, workerData } = require('worker_threads')

const { buffer, trackIndices, trackOffsets } = workerData
const view = Buffer.from(buffer)

const EVENT_CODE = {
    NOTE_ON: 0x09,
    NOTE_OFF: 0x08,
    CONTROL_CHANGE: 0x0b,
    SET_TEMPO: 0x51,
    END_OF_TRACK: 0x2f
}
const EVENT_SIZE = 8

function parseVarlen(offset) {
    let value = 0
    let startOffset = offset
    let checkNextByte = true
    while (checkNextByte) {
        const currentByte = view.readUint8(offset)
        value = (value << 7) | (currentByte & 0x7f)
        ++offset
        checkNextByte = !!(currentByte & 0x80)
    }

    return [value, offset - startOffset]
}

function parseTrack(trackIndex) {
    let eventIndex = 0
    let capacity = 2048 // initial, will grow for larger files
    let packedBuffer = new ArrayBuffer(capacity * EVENT_SIZE)
    let packedView = new DataView(packedBuffer)

    const tempoEvents = []
    let totalTicks = 0
    let currentTick = 0
    let runningStatus = 0

    const trackStartOffset = trackOffsets[trackIndex]
    const trackLength = view.readUint32BE(trackStartOffset + 4)
    let offset = trackStartOffset + 8
    const endOffset = offset + trackLength

    while (offset < endOffset) {
        const deltaTimeVarlen = parseVarlen(offset)
        offset += deltaTimeVarlen[1]
        currentTick += deltaTimeVarlen[0]

        let statusByte = view.readUint8(offset)
        if (statusByte < 0x80) {
            statusByte = runningStatus
        } else {
            runningStatus = statusByte
            ++offset
        }

        const eventType = statusByte >> 4
        let ignore = false

        // packed data
        let eventCode, p1, p2, p3

        switch (eventType) {
            case 0x8: // note off
            case 0x9: // note on
                eventCode = eventType
                const note = view.readUint8(offset++)
                const velocity = view.readUint8(offset++)

                p1 = statusByte & 0x0f // channel
                p2 = note
                p3 = velocity
                break

            case 0xb: // control change
                eventCode = eventType
                const ccNum = view.readUint8(offset++)
                const ccValue = view.readUint8(offset++)
                //if (ccNum !== 64) ignore = true

                p1 = statusByte & 0x0f // channel
                p2 = ccNum
                p3 = ccValue
                break

            // 2-byte event args
            case 0xa: // polyphonic key pressure
            case 0xe: // pitch wheel change
                ++offset
            // fallthrough to add another byte
            // 1-byte event args
            case 0xc: // program change
            case 0xd: // channel pressure
                ++offset
                ignore = true
                break

            case 0xf: // system common / meta event
                if (statusByte === 0xff) {
                    // meta event (actually important)
                    const metaType = view.readUint8(offset++)
                    const lengthVarlen = parseVarlen(offset)
                    offset += lengthVarlen[1]

                    switch (metaType) {
                        case 0x51: // set tempo
                            if (lengthVarlen[0] !== 3) {
                                ignore = true // malformed
                            } else {
                                const uspq = view.readUintBE(offset, 3)
                                tempoEvents.push({ tick: currentTick, uspq: uspq })
                                eventCode = EVENT_CODE.SET_TEMPO
                                p1 = (uspq >> 16) & 0xff
                                p2 = (uspq >> 8) & 0xff
                                p3 = uspq & 0xff
                            }
                            break
                        case 0x2f: // end of track
                            eventCode = EVENT_CODE.END_OF_TRACK
                            offset = endOffset // we're done here
                            break
                        default:
                            ignore = true
                            break
                    }

                    offset += lengthVarlen[0]
                } else if (statusByte === 0xf0 || statusByte === 0xf7) {
                    // sysex
                    ignore = true
                    const lengthVarlen = parseVarlen(offset)
                    offset += lengthVarlen[0] + lengthVarlen[1]
                } else {
                    ignore = true
                }
                break

            default:
                ignore = true
                break
        }

        if (!ignore) {
            // if over capacity, double the allocated size
            if (eventIndex >= capacity) {
                capacity *= 2
                const newBuffer = new ArrayBuffer(capacity * EVENT_SIZE)
                new Uint8Array(newBuffer).set(new Uint8Array(packedBuffer))
                packedBuffer = newBuffer
                packedView = new DataView(packedBuffer)
            }

            const byteOffset = eventIndex * EVENT_SIZE

            // if this triggers it's either a midi that's literal days long
            // or with some *insane* ppqn
            // either way, i'm not allocating ANOTHER 4 bytes to the tick# just to account for that
            if (currentTick > 0xffffffff) {
                throw new Error(
                    `MIDI file too long! Track ${trackIndex} tick count exceeds the maximum supported by the parser.`
                )
            }

            packedView.setUint32(byteOffset, currentTick)
            packedView.setUint8(byteOffset + 4, eventCode)
            packedView.setUint8(byteOffset + 5, p1 || 0)
            packedView.setUint8(byteOffset + 6, p2 || 0)
            packedView.setUint8(byteOffset + 7, p3 || 0)

            ++eventIndex
        }
    }

    packedBuffer = packedBuffer.slice(0, eventIndex * EVENT_SIZE)

    totalTicks = currentTick
    parentPort.postMessage({ trackIndex, packedBuffer, tempoEvents, totalTicks }, [packedBuffer])
}

for (const index of trackIndices) {
    parseTrack(index)
}
