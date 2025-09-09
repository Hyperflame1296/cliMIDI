let { parentPort } = require('node:worker_threads')
let color = require('cli-color')
try {
    let keys = Array.from({ length: 128 }, () => ({ blips: [] }))
    let ansi = {
        moveCursor: (x, y) => `\x1b[${y};${x}H`,
        rgbBackground: v => `\x1b[48;2;${Math.floor(v[0] * 255)};${Math.floor(v[1] * 255)};${Math.floor(v[2] * 255)}m`
    };
    let colors = [
        [
            1,
            0,
            0
        ],
        [
            1,
            0.5333333333333333,
            0
        ],
        [
            1,
            1,
            0
        ],
        [
            0.5333333333333333,
            1,
            0
        ],
        [
            0,
            1,
            0
        ],
        [
            0,
            1,
            0.26666666666666666
        ],
        [
            0,
            1,
            0.5333333333333333
        ],
        [
            0,
            1,
            0.7333333333333333
        ],
        [
            0,
            1,
            1
        ],
        [
            0,
            0.5333333333333333,
            1
        ],
        [
            0,
            0,
            1
        ],
        [
            0.5333333333333333,
            0,
            1
        ],
        [
            1,
            0,
            1
        ],
        [
            1,
            0,
            0.7333333333333333
        ],
        [
            1,
            0,
            0.5333333333333333
        ],
        [
            1,
            0,
            0.26666666666666666
        ]
    ]
    let mul = (a, b) => a.map(x => x * b)
    let meta = {
        tempo: 120,
        fps: 0,
        nc: 0,
    }
    let info = {
        width: 128,
        height: 36,
        visualizer: true,
        noteBuffer: {
            enabled: true,
            length: 100
        },
        maxFPS: 60,
        chosen: 1,
        paused: false,
        loading: false,
    }
    parentPort.on('message', m => {
        switch (m.m) {
            case 'i':
                for (let key of Object.keys(m)) {
                    if (key == 'm')
                        continue
                    info[key] = m[key]
                }
                break
            case 'q':
                for (let e of m.q) {
                    setTimeout(() => {
                        switch (e.type) {
                            case 9: // note on
                                if (keys[e.note].blips.length >= 16)
                                    keys[e.note].blips.shift()

                                keys[e.note].blips.push({ color: colors[(e.track ?? (e.channel ?? 0)) % colors.length], timePlayed: performance.now(), prevLength: keys[e.note].blips.length })
                                meta.nc += 1
                                break
                            case 255:
                                switch (e.metaType) {
                                    case 81:
                                        meta.tempo = 60_000_000 / e.uspq
                                        break
                                }
                                break
                        }
                    }, e.t)
                }
                break
            case 'n':
                switch (m.type) {
                    case 9: // note on
                        if (keys[m.note].blips.length >= 16)
                            keys[m.note].blips.shift()
                        keys[m.note].blips.push({ color: colors[(m.track ?? (m.channel ?? 0)) % colors.length], timePlayed: performance.now(), prevLength: keys[m.note].blips.length })
                        meta.nc += 1
                        break
                    case 255:
                        switch (m.metaType) {
                            case 81:
                                meta.tempo = 60_000_000 / m.uspq
                                break
                        }
                        break
                }
                break
        }
    })
    let frames = 0;
    let lastTime = performance.now();
    let fps = 0;
    let getStatusText = () => {
        if (info.loading)
            return 'Loading...'
        else if (info.paused)
            return 'Paused'
        else if (info.chosen == 1)
            return 'Playing with jmidiplayer'
        else if (info.chosen == 2)
            return 'Playing with JZZ'
        else if (info.chosen == 3)
            return 'Playing with MIDIPlayerJS'
        else
            return 'Unknown'
    }
    function update() {
        let frame = '';
        let now = performance.now();
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i]
            // don't draw the key if no blips are being rendered
            if (key.blips.length == 0)
                continue
            
            if (key.prevLength != key.blips.length) // don't remove the previous key if they're the same length
                for (let j = 0; j <= 16; j++) {
                    frame += (
                        ansi.moveCursor(i + 1, j) + 
                        ' ' + `\x1b[0m`
                    )
                }
            
            for (let blip of key.blips) {
                // remove blip if timer ran out
                if (now - blip.timePlayed > 1000) {
                    key.blips.splice(key.blips.indexOf(blip), 1)
                    continue
                }
                // draw blip
                let brightness = (1000 - (now - blip.timePlayed)) / 1000
                frame += (
                    ansi.moveCursor(i + 1, 16 - key.blips.indexOf(blip)) + 
                    ansi.rgbBackground(mul(blip.color, brightness)) + ' ' + `\x1b[0m`
                )
            }
        }
        let offset = 0
        frame += ansi.moveCursor(0, 17) + ' '.repeat((info.width) - 1)
        let metaKeys = Object.keys(meta)
        for (let m of metaKeys) {
            let value = meta[m]
            let index = metaKeys.indexOf(m)
            let str = index == metaKeys.length - 1 ? `${m}: ${value?.toFixed(2)}` : `${m}: ${value?.toFixed(2)}, `
            frame += (
                ansi.moveCursor(offset, 17) +
                str
            )
            offset += str.length
        }
        for (let y = 18; y <= 21; y++) {
            frame += ansi.moveCursor(0, y) + ' '.repeat((info.width) - 1)
            switch (y) {
                case 18:
                    frame += ansi.moveCursor(0, 18) + (info.noteBuffer.enabled ? color.greenBright(`Note buffer length: ${info.noteBuffer.length}ms`) : color.greenBright(`Note buffer length: `) + color.white('(disabled)'))
                    break
                case 19:
                    frame += ansi.moveCursor(0, 19) + color.greenBright(`Max FPS: ${(info.maxFPS).toFixed(2)}fps`)
                    break
                case 20:
                    frame += ansi.moveCursor(0, 20) + color.yellowBright(getStatusText())
                    break
                case 21:
                    frame += ansi.moveCursor(0, 21) + color.whiteBright(
                        info.chosen != 1 ? 
                            [
                                'Keybinds:',
                                '    - Space: pause',
                                '    - ESC: exit',
                                '    - left/right arrows: seek (+-3s)'
                            ].join('\n')
                        : 
                            [
                                'Keybinds:',
                                '    - Space: pause',
                                '    - ESC: exit',
                                'The current MIDI player does not support seeking.'
                            ].join('\n')
                    )
                    break
            }
        }
        process.stdout.write(frame)
        frames++;
        now = performance.now();
        if (now - lastTime >= 1000) {
            fps = frames;
            frames = 0;
            lastTime = now;
            meta.fps = fps
        }
    }
    function loop() {
        let int = setInterval(() => {
            update()
        }, 1000 / info.maxFPS)
        parentPort.on('message', m => {
            switch (m.m) {
                case 'i':
                    clearInterval(int)
                    int = setInterval(() => {
                        update()
                    }, info.maxFPS <= 0 ? 0 : 1000 / info.maxFPS)
                    break
            }
        })
    }
    loop()
} catch (err) {
    console.clear()
    console.log(color.redBright('An error has occured!'))
    console.log(color.whiteBright(`${err.stack}`))
}