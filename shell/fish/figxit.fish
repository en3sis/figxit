status is-interactive; or return 0

function figxit
    if test -n "$FIGXIT_APP"
        $FIGXIT_APP/Contents/MacOS/figxit-engine $argv
    else if test -f $_figxit_home/engine/src/main.ts; and command -q bun
        bun run $_figxit_home/engine/src/main.ts $argv
    else
        $_figxit_home/dist/Figxit.app/Contents/MacOS/figxit-engine $argv
    end
end

set -q _figxit_sep; and return 0
if string match -q -r '^[0-3]\.' -- $version
    echo "figxit: fish 4 or later is needed, this shell is fish $version" >&2
    return 0
end

set -g _figxit_sep \x1f
set -g _figxit_sock $FIGXIT_SOCK
test -n "$_figxit_sock"; or set _figxit_sock $HOME/.local/state/figxit/engine.sock
set -g _figxit_dir (path dirname -- $_figxit_sock)/shell-$fish_pid
set -g _figxit_home $FIGXIT_HOME
test -n "$_figxit_home"; or set _figxit_home (path resolve -- (status dirname)/../..)
set -g _figxit_pid
set -g _figxit_last
set -g _figxit_painted 0
set -g _figxit_reply
set -g _figxit_id 0
set -g _figxit_turn 0
set -g _figxit_retry 0
set -g _figxit_bound 0
set -g _figxit_lost 0
set -g _figxit_plain 1
test -n "$TMUX" -a -n "$TMUX_PANE"; and set _figxit_plain 0
set -g _figxit_functions (bind --function-names)

for _figxit_module in connect keys bind hooks
    source (status dirname)/$_figxit_module.fish
end
set -e _figxit_module

