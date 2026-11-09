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
    if _figxit_accept "R$_figxit_sep"1; and test "$_figxit_reply[4]" != 1
        _figxit_hook
    else
        _figxit_pass $argv[1]
    end
end

function _figxit_recalled
    _figxit_state
    set _figxit_last "$_figxit_cursor$_figxit_sep$_figxit_buffer"
    set _figxit_painted $_figxit_cursor
    _figxit_send N
end

function _figxit_move
    if _figxit_visible
        _figxit_send "K$_figxit_sep$argv[2]"
    else
        _figxit_pass $argv[1]
        _figxit_recalled
    end
end

function _figxit_esc
    if _figxit_visible
        _figxit_send "K$_figxit_sep"esc
    else
        _figxit_pass $argv[1]
        _figxit_hook
    end
end
