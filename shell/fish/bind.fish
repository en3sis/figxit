function _figxit_bind
    set -l keys tab ctrl-i enter ctrl-j ctrl-m up down escape
    set -l handlers tab tab enter enter enter 'move up' 'move down' esc
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
