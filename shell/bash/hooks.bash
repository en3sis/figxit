_figxit_hook() {
  _figxit_unpush
  if (( _figxit_recall )); then
    _figxit_recall=0
    _figxit_last="$READLINE_POINT$_figxit_sep$READLINE_LINE"
    _figxit_send N
    return 0
  fi
  [[ -n $_figxit_out ]] || return 0
  read -t 0 && return 0
  local state="$READLINE_POINT$_figxit_sep$READLINE_LINE"
  [[ $state == "$_figxit_last" ]] && return 0
  _figxit_last=$state
  _figxit_send "E${_figxit_sep}${READLINE_POINT}${_figxit_sep}${PWD}${_figxit_sep}${READLINE_LINE//$'\n'/$'\x1e'}${_figxit_sep}${COLUMNS} ${LINES}"
}

_figxit_prompt() {
  _figxit_last=
  _figxit_visible=0
  [[ -n $_figxit_bound ]] || _figxit_keytimeout
  local mode=emacs
  shopt -q -o vi && mode=vi
  if [[ " $_figxit_bound " != *" $mode "* ]]; then
    _figxit_bound+=" $mode"
    [[ -n $(trap -p PIPE) ]] && _figxit_trap=0
    if [[ $mode == vi ]]; then
      _figxit_bind vi-insert
      _figxit_bind_command
    else
      _figxit_bind emacs
    fi
  fi
  _figxit_open || return 0
  _figxit_drain
  _figxit_aliases
  _figxit_send L
  return 0
}
