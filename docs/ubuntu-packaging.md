# Ubuntu packaging

This project can be packaged as a Linux desktop app with Electron Builder. The Ubuntu-oriented output is a `.deb` installer; a separate generic Linux command can also attempt an AppImage for portable testing.

## Build on Ubuntu

Use Node.js 20 or newer.

```bash
npm ci
npm test
npm run desktop:dist:ubuntu
```

Expected artifacts:

```text
dist-desktop/vibecoding-voice-<version>-ubuntu-amd64.deb
dist-desktop/linux-unpacked/
```

Install the `.deb` package:

```bash
sudo apt install ./dist-desktop/vibecoding-voice-<version>-ubuntu-amd64.deb
```

For a generic Linux build that also attempts an AppImage, use:

```bash
npm run desktop:dist:linux
```

## Runtime setup

The desktop app stores its user config at:

```text
~/.config/vibecoding-voice/config.env
```

For voice-to-Codex or voice-to-Claude on Ubuntu, install the CLI you want and choose that mode in the app:

```bash
npm install -g @openai/codex
npm install -g @anthropic-ai/claude-code
```

For text injection mode, Ubuntu needs extra desktop automation tools:

```bash
sudo apt install xdotool xclip wtype
```

Injection support is best on X11 with `xdotool` + `xclip`. On Wayland, the app tries `wtype`, but support depends on the compositor and desktop security policy. If injection is unreliable on Ubuntu GNOME Wayland, use Codex/Claude mode or log in with an Xorg session.

## Build from Windows

The `desktop:dist:linux` script can be invoked from the repo, but Linux desktop packages are most reliable when built inside Ubuntu, WSL, or Linux CI because the toolchain can validate Linux metadata and system dependencies in the target environment.

If Electron Builder creates `dist-desktop/linux-unpacked` but cannot finish `.deb` packaging on Windows because `fpm` is unavailable, build the Debian package from Ubuntu/WSL with:

```bash
bash scripts/build-ubuntu-deb.sh
```
