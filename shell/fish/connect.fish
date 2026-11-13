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
    _figxit_send "H$_figxit_sep$fish_pid$_figxit_sep"(string split -m1 , -- "$TMUX")[1]"$_figxit_sep$TMUX_PANE$_figxit_sep"(string join : -- $PATH)"$_figxit_sep$TERM_PROGRAM$_figxit_sep$HERDR_PANE_ID$_figxit_sep$HERDR_SOCKET_PATH$_figxit_sep$HERDR_BIN_PATH"
    _figxit_aliases 1
end

function _figxit_aliases
    test -n "$_figxit_pid" -a $_figxit_lost -eq 0; or return 0
    set -l list (string join \x1e -- (abbr --show 2>/dev/null | string match -rv '[\x1e\x1f]'))
    test "$argv[1]" != 1 -a "$list" = "$_figxit_alias_state"; and return 0
    _figxit_send "U$_figxit_sep$list"; and set -g _figxit_alias_state "$list"
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

function _figxit_visible
    test -n "$_figxit_pid" -a $_figxit_lost -eq 0; or return 1
    set -l visible
    read visible <$_figxit_dir/state 2>/dev/null; or return 1
    test "$visible" = 1
end
