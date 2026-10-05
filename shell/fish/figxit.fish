status is-interactive; or return 0
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

function _figxit_command
    if test -n "$FIGXIT_BRIDGE"
        string split ' ' -- $FIGXIT_BRIDGE
    else if test -n "$FIGXIT_APP"
        echo $FIGXIT_APP/Contents/MacOS/figxit-engine
        echo bridge
    else if test -f $_figxit_home/engine/src/main.ts; and command -q bun
        printf '%s\n' bun run $_figxit_home/engine/src/main.ts bridge
    else if test -x $_figxit_home/dist/Figxit.app/Contents/MacOS/figxit-engine
        echo $_figxit_home/dist/Figxit.app/Contents/MacOS/figxit-engine
        echo bridge
    end
end

function _figxit_send
    test -n "$_figxit_pid"; and echo $argv[1] >>$_figxit_dir/in 2>/dev/null
end

function _figxit_open
    test -n "$_figxit_pid"; and return 0
    set -l now (date +%s)
    test $now -lt $_figxit_retry; and return 1
    set _figxit_retry (math $now + 3)
    set -l run (_figxit_command)
    test (count $run) -gt 0; or return 1
    command mkdir -p $_figxit_dir; or return 1
    echo -n >$_figxit_dir/in
    echo 0 >$_figxit_dir/state
    echo -n >$_figxit_dir/reply
    echo $_figxit_turn >$_figxit_dir/seen
    FIGXIT_HOME=$_figxit_home command $run --dir $_figxit_dir $fish_pid </dev/null >/dev/null 2>&1 &
    set _figxit_pid $last_pid
    disown $_figxit_pid 2>/dev/null
    set _figxit_lost 0
    _figxit_send "H$_figxit_sep$fish_pid$_figxit_sep"(string split -m1 , -- "$TMUX")[1]"$_figxit_sep$TMUX_PANE$_figxit_sep"(string join : -- $PATH)"$_figxit_sep$TERM_PROGRAM"
end

function _figxit_wait
    set -l turn 0
    set -l line
    while test $turn -lt $argv[1]
        if read line <$_figxit_dir/reply 2>/dev/null; and string match -q -- "$_figxit_id$_figxit_sep*" $line
            set _figxit_reply (string split -- $_figxit_sep $line)
            return 0
        end
        set turn (math $turn + 1)
    end
    set _figxit_lost 1
    echo 0 >$_figxit_dir/state
    return 1
end

function _figxit_state
    set -g _figxit_buffer "$(commandline)"
    set -g _figxit_cursor (commandline -C)
end

function _figxit_hook
    test -n "$_figxit_pid" -a $_figxit_lost -eq 0; or return 0
    _figxit_state
    test "$_figxit_cursor$_figxit_sep$_figxit_buffer" = "$_figxit_last"; and return 0
    set -l key
    if test $_figxit_plain -eq 1
        set _figxit_id (math $_figxit_id + 1)
        _figxit_send "p$_figxit_sep$_figxit_id$_figxit_sep$COLUMNS$_figxit_sep$LINES$_figxit_sep"(math $_figxit_cursor - $_figxit_painted)
        _figxit_wait 1500; or return 0
        set key $_figxit_reply[3]
        if test -n "$_figxit_reply[2]"
            commandline -i -- $_figxit_reply[2]
            _figxit_state
        end
    end
    set _figxit_last "$_figxit_cursor$_figxit_sep$_figxit_buffer"
    set _figxit_painted $_figxit_cursor
    _figxit_send "E$_figxit_sep$_figxit_cursor$_figxit_sep$PWD$_figxit_sep"(string replace -a \n \x1e -- $_figxit_buffer)
    switch "$key"
        case enter
            _figxit_enter enter
        case tab
            _figxit_tab tab
        case backspace
            commandline -f backward-delete-char
    end
end

function _figxit_visible
    test -n "$_figxit_pid" -a $_figxit_lost -eq 0; or return 1
    set -l visible
    read visible <$_figxit_dir/state 2>/dev/null; or return 1
    test "$visible" = 1
end

function _figxit_accept
    _figxit_visible; or return 1
    _figxit_state
    test "$_figxit_cursor$_figxit_sep$_figxit_buffer" = "$_figxit_last"; or return 1
    set _figxit_id (math $_figxit_id + 1)
    _figxit_send "a$_figxit_sep$_figxit_id$_figxit_sep$argv[1]"
    _figxit_wait 4000; or return 1
    set -l count $_figxit_reply[2]
    set -l text $_figxit_reply[3]
    test "$count" -ge 0 2>/dev/null; or return 1
    set -l keep (math $_figxit_cursor - $count)
    commandline -r -- (string sub -l $keep -- $_figxit_buffer)$text(string sub -s (math $_figxit_cursor + 1) -- $_figxit_buffer)
    commandline -C (math $keep + (string length -- "$text"))
    return 0
end

function _figxit_run
    for step in $argv
        if contains -- $step $_figxit_functions
            commandline -f $step
        else
            eval $step
        end
    end
end

function _figxit_pass
    set -l name _figxit_orig_(string escape --style=var -- $argv[1])
    eval _figxit_run $$name
end

function _figxit_tab
    if _figxit_accept A
        _figxit_hook
    else
        _figxit_pass $argv[1]
    end
end

function _figxit_enter
    if _figxit_accept R
        _figxit_hook
    else
        _figxit_pass $argv[1]
    end
end

function _figxit_move
    if _figxit_visible
        _figxit_send "K$_figxit_sep$argv[2]"
    else
        _figxit_pass $argv[1]
        _figxit_hook
    end
end

function _figxit_bind
    set -l keys tab ctrl-i enter ctrl-j ctrl-m up down
    set -l handlers tab tab enter enter enter 'move up' 'move down'
    for line in (bind --preset) (bind --user)
        set -l part (string match -r -- '^bind (?:--preset |--user )?(\S+) (.+)$' $line); or continue
        set -l key $part[2]
        set -l rest $part[3]
        string match -q -- '-*' $key; and continue
        string match -q -- '*_figxit_*' $rest; and continue
        set -l at (contains -i -- $key $keys)
        if test -n "$at"
            set -l handler (string split ' ' -- $handlers[$at])
            set -g _figxit_orig_(string escape --style=var -- $key) $rest
            bind $key "_figxit_$handler[1] $key $handler[2]"
        else if not string match -q -r -- '(^| )execute( |$)' $rest
            eval "bind $key $rest _figxit_hook"
        end
    end
end

function _figxit_prompt --on-event fish_prompt
    if test $_figxit_bound -eq 0
        set _figxit_bound 1
        if test "$fish_key_bindings" != fish_default_key_bindings
            set _figxit_bound 2
            echo "figxit: fish vi mode is not supported, the popup is off in this shell" >&2
        else
            _figxit_bind
        end
    end
    test $_figxit_bound -eq 1; or return 0
    set -l seen
    if test -n "$_figxit_pid"
        read seen <$_figxit_dir/seen 2>/dev/null
        if test $_figxit_lost -eq 1 -o "$seen" != "$_figxit_turn"; and not command kill -0 $_figxit_pid 2>/dev/null
            set _figxit_pid
        end
    end
    set _figxit_lost 0
    set _figxit_last
    set _figxit_painted 0
    _figxit_open; or return 0
    set _figxit_turn (math $_figxit_turn + 1)
    _figxit_send "L$_figxit_sep$_figxit_turn"
end

function _figxit_preexec --on-event fish_preexec
    set _figxit_last
    _figxit_send X
end

function _figxit_cancel --on-event fish_cancel
    set _figxit_last
    set _figxit_painted 0
    _figxit_send L
end

function _figxit_exit --on-event fish_exit
    _figxit_send q
end
