_figxit_line_init() {
  _figxit_last= _figxit_typed=
  _figxit_visible=0 _figxit_held=0
  _figxit_connect || return 0
  _figxit_bind
  _figxit_send L
}

_figxit_redraw() {
  _figxit_release && return 0
  if [[ -z $_figxit_fd ]]; then
    _figxit_connect || return 0
    _figxit_bind
  fi
  if (( $funcstack[(I)figxit-tab] )) || [[ $LASTWIDGET == (*complete*|menu-select|list-choices) ]] ||
    { (( _figxit_held )) && [[ $BUFFER == "$_figxit_last" || $LASTWIDGET == (figxit-*|_figxit_*) ]] }; then
    _figxit_hold
    return 0
  fi
  _figxit_held=0
  (( PENDING )) && return 0
  if [[ $KEYMAP == vicmd ]]; then
    (( _figxit_visible )) && _figxit_send "K${_figxit_sep}esc"
    return 0
  fi
  local state="$CURSOR$_figxit_sep$BUFFER"
  [[ $state == "$_figxit_last" ]] && return 0
  _figxit_last=$state
  _figxit_send "E${_figxit_sep}${CURSOR}${_figxit_sep}${PWD}${_figxit_sep}${BUFFER//$'\n'/$'\x1e'}${_figxit_sep}${COLUMNS} ${LINES}"
}

_figxit_hold() {
  (( _figxit_held )) || _figxit_send N
  _figxit_held=1 _figxit_last=$BUFFER
}

_figxit_preexec() {
  local REPLY
  _figxit_visible=0
  _figxit_send X
  [[ -n $_figxit_asked ]] && _figxit_report drain
  return 0
}

_figxit_precmd() {
  (( _figxit_reports == 0 )) && _figxit_reports=1
  (( _figxit_timed )) || _figxit_keytimeout
  _figxit_connect && _figxit_bind
  return 0
}

_figxit_hook() {
  local hook=zle-$1
  local -a extant
  zstyle -g extant $hook widgets
  if [[ -n $widgets[$hook] && $widgets[$hook] != user:azhw:$hook ]] && (( $#extant )); then
    [[ -n ${(M)extant:#(<->:|)$2} ]] && return 0
    zle -N -- $2
    zstyle -- $hook widgets $extant 90:$2
  else
    add-zle-hook-widget $1 $2
  fi
}
