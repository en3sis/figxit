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
    _figxit_send "E$_figxit_sep$_figxit_cursor$_figxit_sep$PWD$_figxit_sep"(string replace -a \n \x1e -- $_figxit_buffer)"$_figxit_sep$COLUMNS $LINES"
    switch "$key"
        case enter
            _figxit_enter enter
        case tab
            _figxit_tab tab
        case backspace
            commandline -f backward-delete-char
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
