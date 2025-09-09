let { Player } = require('./modules/jmidiplayer/index')
let midi = require('@julusian/midi')
let color = require('cli-color')
let { Worker } = require('node:worker_threads');
let JZZ = require('jzz')
let fs = require('node:fs')
require('jzz-midi-smf')(JZZ);
let PlayerMPJS = require('midi-player-js').Player
let dialog = require('easy-file-dialogs')
let remove_json_comments = require('strip-json-comments').default;
let settingsFile = fs.existsSync('./settings.json')
process.stdin.setRawMode(true)
let defaultSettings = {
    visualizer: true,
    noteBuffer: {
        enabled: true,
        length: 100
    },
    maxFPS: 60
}
console.clear()
if (!settingsFile) {
    console.log(color.yellowBright('No settings file detected. Creating one...'))
    fs.writeFileSync('./settings.json', JSON.stringify(defaultSettings, null, 4), 'utf-8')
}
let settings = JSON.parse(remove_json_comments(fs.readFileSync('./settings.json', 'utf-8')))
if (settings.noteBuffer.enabled && !settings.visualizer) console.warn('WARNING - if visualizer is disabled, noteBuffer should also be!')
let start = (async(chosen) => {
    if (settings.visualizer) var thread = new Worker('./threads/visualizer.js')
    try {
        console.clear()
        if (settings.visualizer) thread.postMessage({ 
            m: 'i', 
            width: process.stdout.columns, 
            height: process.stdout.rows, 
            noteBuffer: settings.noteBuffer, 
            maxFPS: settings.maxFPS, 
            chosen,
            paused: false 
        })
        let midiPath = await dialog.openFileName({
            title: 'Choose a MIDI file.',
            initialDir: 'midis/',
            fileTypes: [
                [
                    "MIDI file",
                    "*.mid"
                ],
            ],
            multiple: false
        })
        let q = []
        let output = new midi.Output();
        for (let i = 0; i < output.getPortCount(); i++) {
            if (output.getPortName(i).includes('Keppy\'s Direct MIDI API')) {
                output.openPort(i)
                break
            }
            if (output.getPortName(i).includes('OmniMIDI')) {
                output.openPort(i)
                break
            }
        }
        let cc = {
            expression: {},
            modulation: {},
            panpot: {},
            pitch_bend: {},
            sustain: {},
            cutoff: {},
            resonance: {},
            reverb: {},
            chorus: {}
        }
        let pedalNotes = []
        let lastQueue = performance.now()
        if (settings.visualizer)
            if (settings.noteBuffer.enabled)
                setInterval(() => {
                    thread.postMessage({ m: 'q', q, lastQueue: performance.now() })
                    q = []
                    lastQueue = performance.now()
                }, settings.noteBuffer.length)
        let paused = false
        let pause = () => {
            paused = !paused
            if (settings.visualizer) thread.postMessage({ m: 'i', paused })
        }
        process.stdin.on('data', e => {
            switch (e[0]) {
                case 0x20:
                    pause()
            }
        });
        let begin
        let end;
        switch (chosen) {
            case 1:
                let player = new Player()
                begin = performance.now()
                if (!settings.visualizer) console.log(color.yellowBright('Loading MIDI...'))
                if (settings.visualizer) thread.postMessage({ m: 'i', loading: true })
                await player.loadFile(midiPath)
                end = performance.now()
                if (!settings.visualizer) console.log(color.cyanBright('Loaded MIDI! ') + color.white(`(in ${((end - begin) / 1000).toFixed(2)}s)`))
                if (!settings.visualizer) console.log(color.greenBright('Playing MIDI...'))
                if (settings.visualizer) thread.postMessage({ m: 'i', loading: false })
                player.play()
                player.on('midiEvent', e => {
                    switch (e.type) {
                        case 8: // note off
                            if (!cc.sustain[e.channel])
                                output.sendMessage([0x80 | e.channel, e.note, e.velocity])
                            break
                        case 9: // note on
                            output.sendMessage([0x90 | e.channel, e.note, e.velocity])
                            if (cc.sustain[e.channel])
                                pedalNotes.push([0x80 | e.channel, e.note, e.velocity])
                            if (settings.visualizer) {
                                if (settings.noteBuffer.enabled)
                                    q.push({ t: performance.now() - lastQueue, ...e })
                                else thread.postMessage({ m: 'n', ...e })
                            }
                            break
                        case 11:
                            switch (e.ccNum) {
                                case 1: // modulation
                                    cc.modulation = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 1, e.ccValue])
                                    break
                                case 7: // volume
                                    cc.volume = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 7, e.ccValue])
                                    break
                                case 10: // panpot
                                    cc.panpot = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 10, e.ccValue])
                                    break
                                case 11: // expression
                                    cc.expression = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 11, e.ccValue])
                                    break
                                case 64:
                                    if (e.ccValue >= 64) {
                                        cc.sustain[e.channel] = true
                                    } else {
                                        cc.sustain[e.channel] = false
                                        for (let note of pedalNotes) {
                                            output.sendMessage(note)
                                        }
                                        pedalNotes = []
                                    }
                                    break
                                case 71: // resonance
                                    cc.resonance = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 71, e.ccValue])
                                    break
                                case 74: // cutoff
                                    cc.cutoff = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 74, e.ccValue])
                                    break
                                case 91: // reverb
                                    cc.reverb = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 91, e.ccValue])
                                    break
                                case 93: // chorus
                                    cc.chorus = e.ccValue
                                    output.sendMessage([0xb0 | e.channel, 93, e.ccValue])
                                    break
                                default:
                                    output.sendMessage([0xb0 | e.channel, e.number, e.ccValue])
                                    break
                            }
                            break
                        case 255:
                            switch (e.metaType) {
                                case 81:
                                    if (settings.visualizer) {
                                        if (settings.noteBuffer.enabled)
                                            q.push({ t: performance.now() - lastQueue, ...e })
                                        else thread.postMessage(e)
                                    }
                                    break
                            }
                            break
                    }
                })
                player.on('endOfFile', async() => {
                    if (settings.visualizer) await thread.terminate()
                    console.clear()
                    console.log(color.greenBright('MIDI file has ended!'))
                    console.log(color.whiteBright('Hit Ctrl+C to exit now.'))
                })
                pause = () => {
                    paused ? player.play() : player.pause()
                    paused = !paused
                    if (settings.visualizer) thread.postMessage({ m: 'i', paused })
                }
                break
            case 2:
                let widget = JZZ.Widget({
                    _receive: msg => {
                        if (msg.isNoteOff() || (msg.isNoteOn() && msg.getVelocity() <= 0)) {
                            let note = msg.getNote()
                            let velocity = msg.getVelocity()
                            let channel = msg.getChannel()
                            if (!cc.sustain[channel])
                                output.sendMessage([0x80 | channel, note, velocity])
                        } else if (msg.isNoteOn()) {
                            let note = msg.getNote()
                            let velocity = msg.getVelocity()
                            let channel = msg.getChannel()
                            output.sendMessage([0x90 | channel, note, velocity])
                            if (cc.sustain[channel])
                                pedalNotes.push([0x80 | channel, note, velocity])
                            if (settings.visualizer) {
                                if (settings.noteBuffer.enabled)
                                    q.push({
                                        type: 9,
                                        channel,
                                        note,
                                        velocity,
                                        t: performance.now() - lastQueue
                                    })
                                else
                                    thread.postMessage({
                                        m: 'n',
                                        type: 9,
                                        channel,
                                        note,
                                        velocity
                                    })
                            }
                        } else if (msg.isTempo()) {
                            let uspq = msg.getTempo()
                            if (settings.visualizer) {
                                if (settings.noteBuffer.enabled)
                                    q.push({
                                        type: 255,
                                        metaType: 81,
                                        uspq,
                                        t: performance.now() - lastQueue,
                                    })
                                else
                                    thread.postMessage({
                                        m: 'n',
                                        type: 255,
                                        metaType: 81,
                                        uspq
                                    })
                            }
                        }// else if (msg.isSysEx()) console.log(msg.getSysExId())
                    }
                })
                JZZ.addMidiOut('jzzPlayerOut', widget)
                    let jzzPlayerOut = JZZ()
                        .openMidiOut('jzzPlayerOut')
                if (!settings.visualizer) console.log(color.yellowBright('Loading MIDI...'))
                begin = performance.now()
                let smf = new JZZ.MIDI.SMF(fs.readFileSync(midiPath))
                let playerJZZ = smf.player()
                playerJZZ.onEnd = async() => {
                    if (settings.visualizer) await thread.terminate()
                    console.clear()
                    console.log(color.greenBright('MIDI file has ended!'))
                    console.log(color.whiteBright('Hit Ctrl+C to exit now.'))
                }
                playerJZZ.connect(jzzPlayerOut)
                end = performance.now()
                if (!settings.visualizer) console.log(color.cyanBright('Loaded MIDI! ') + color.white(`(in ${((end - begin) / 1000).toFixed(2)}s)`))
                if (!settings.visualizer) console.log(color.greenBright('Playing MIDI...'))
                playerJZZ.play()
                pause = () => {
                    paused ? playerJZZ.resume() : playerJZZ.pause()
                    paused = !paused
                    if (settings.visualizer) thread.postMessage({ m: 'i', paused })
                }
                break
            case 3:
                let playermpjs = new PlayerMPJS()
                if (!settings.visualizer) console.log(color.yellowBright('Loading MIDI...'))
                begin = performance.now()
                playermpjs.loadFile(midiPath)
                end = performance.now()
                if (!settings.visualizer) console.log(color.cyanBright('Loaded MIDI! ') + color.white(`(in ${((end - begin) / 1000).toFixed(2)}s)`))
                if (!settings.visualizer) console.log(color.greenBright('Playing MIDI...'))
                playermpjs.play()
                pause = () => {
                    paused ? playermpjs.play() : playermpjs.pause()
                    paused = !paused
                    if (settings.visualizer) thread.postMessage({ m: 'i', paused })
                }
                playermpjs.on('midiEvent', e => {
                    switch (e.name) {
                        case 'Note off':
                            if (!cc.sustain[e.channel])
                                output.sendMessage([0x80 | (e.channel - 1), e.noteNumber, e.velocity])
                            break
                        case 'Note on':
                            output.sendMessage([0x90 | (e.channel - 1), e.noteNumber, e.velocity])
                            if (cc.sustain[e.channel])
                                pedalNotes.push([0x80 | (e.channel - 1), e.noteNumber, e.velocity])
                            if (settings.visualizer) {
                                if (settings.noteBuffer.enabled)
                                    q.push({
                                        type: 9,
                                        track: e.track - 2,
                                        channel: e.channel - 1,
                                        note: e.noteNumber,
                                        velocity: e.velocity,
                                        t: performance.now() - lastQueue,
                                    })
                                else
                                    thread.postMessage({
                                        m: 'n',
                                        type: 9,
                                        track: e.track - 2,
                                        channel: e.channel - 1,
                                        note: e.noteNumber,
                                        velocity: e.velocity
                                    })
                            }
                            break
                        case 'Controller Change':
                            switch (e.number) {
                                case 1: // modulation
                                    cc.modulation = e.value
                                    output.sendMessage([0xb0 | e.channel, 1, e.value])
                                    break
                                case 7: // volume
                                    cc.volume = e.value
                                    output.sendMessage([0xb0 | e.channel, 7, e.value])
                                    break
                                case 10: // panpot
                                    cc.panpot = e.value
                                    output.sendMessage([0xb0 | e.channel, 10, e.value])
                                    break
                                case 11: // expression
                                    cc.expression = e.value
                                    output.sendMessage([0xb0 | e.channel, 11, e.value])
                                    break
                                case 64:
                                    if (e.value >= 64) {
                                        cc.sustain[e.channel] = true
                                    } else {
                                        cc.sustain[e.channel] = false
                                        for (let note of pedalNotes) {
                                            output.sendMessage(note)
                                        }
                                        pedalNotes = []
                                    }
                                    break
                                case 71: // resonance
                                    cc.resonance = e.value
                                    output.sendMessage([0xb0 | e.channel, 71, e.value])
                                    break
                                case 74: // cutoff
                                    cc.cutoff = e.value
                                    output.sendMessage([0xb0 | e.channel, 74, e.value])
                                    break
                                case 91: // reverb
                                    cc.reverb = e.value
                                    output.sendMessage([0xb0 | e.channel, 91, e.value])
                                    break
                                case 93: // chorus
                                    cc.chorus = e.value
                                    output.sendMessage([0xb0 | e.channel, 93, e.value])
                                    break
                                default:
                                    output.sendMessage([0xb0 | e.channel, e.number, e.value])
                                    break
                            }
                            break
                        case 'Set Tempo':
                            if (settings.visualizer) {
                                if (settings.noteBuffer.enabled)
                                    q.push({
                                        type: 255,
                                        metaType: 81,
                                        uspq: 60000000 / e.data,
                                        t: performance.now() - lastQueue
                                    })
                                else
                                    thread.postMessage({
                                        m: 'n',
                                        type: 255,
                                        metaType: 81,
                                        uspq: 60000000 / e.data
                                    })
                            }
                            break
                    }
                })
                break
        }
    } catch (err) {
        if (settings.visualizer) await thread.terminate()
        console.clear()
        console.log(color.redBright('An error has occured!'))
        console.log(color.whiteBright(`${err.stack}`))
        process.exit()
    }
})
console.log(color.greenBright('Welcome to cliMIDI!                 '))
console.log(color.cyanBright ('Which player you want to use?       '))
console.log(color.whiteBright('    1 - jmidiplayer (recommended)   '))
console.log(color.whiteBright('    2 - jzz                         '))
console.log(color.whiteBright('    3 - midi-player-js              '))
console.log(color.whiteBright('Press any other key to exit.        '))
let started = false
process.stdin.on('data', e => {
    if (!started) {
        let decoder = new TextDecoder()
        let tx = decoder.decode(e)
        switch (tx.trim()[0]) {
            case '1':
                started = true
                start(1)
                break
            case '2':
                started = true
                start(2)
                break
            case '3':
                started = true
                start(3)
                break
            default:
                console.log(color.redBright('Exited.'))
                process.exit()
        }
    } else {
        switch (e[0]) {
            case 0x03:
                console.clear()
                console.log(color.redBright('Exited.'))
                process.exit()
        }
    }
});