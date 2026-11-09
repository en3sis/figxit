_figxit_close() {
  [[ -n $_figxit_fd ]] || return
  zle -F $_figxit_fd 2>/dev/null
  exec {_figxit_fd}>&-
  _figxit_fd=
  _figxit_visible=0
}

_figxit_send() {
  [[ -n $_figxit_fd ]] || return 1
  print -r -u $_figxit_fd -- $1 2>/dev/null || { _figxit_close; return 1 }
}

_figxit_start() {
  [[ -e ${_figxit_sock:h}/stopped ]] && return 0
  if [[ -n $FIGXIT_APP ]]; then
    open -g $FIGXIT_APP &>/dev/null
    return 0
  fi
  [[ -n $FIGXIT_AUTOSTART ]] || return 0
  if [[ -n $FIGXIT_ENGINE ]]; then
    ${=FIGXIT_ENGINE} &>/dev/null &!
  elif [[ -d $FIGXIT_HOME/dist/Figxit.app ]]; then
    open -g $FIGXIT_HOME/dist/Figxit.app &>/dev/null
  fi
}

_figxit_connect() {
  [[ -n $_figxit_fd ]] && return 0
  (( EPOCHSECONDS < _figxit_retry )) && return 1
  if ! zsocket $_figxit_sock 2>/dev/null; then
    _figxit_retry=$(( EPOCHSECONDS + 3 ))
    _figxit_start
    return 1
  fi
  _figxit_fd=$REPLY
  zle -F -w $_figxit_fd _figxit_recv
  _figxit_send "H${_figxit_sep}$$${_figxit_sep}${TMUX%%,*}${_figxit_sep}${TMUX_PANE}${_figxit_sep}${PATH}${_figxit_sep}${TERM_PROGRAM}${_figxit_sep}${HERDR_PANE_ID}${_figxit_sep}${HERDR_SOCKET_PATH}${_figxit_sep}${HERDR_BIN_PATH}"
}

_figxit_apply() {
  local -a f
  f=("${(@ps:$_figxit_sep:)1}")
  [[ $f[1] == S ]] && _figxit_visible=$f[2]
}

_figxit_drop() {
  local fd=$1
  if [[ $fd == $_figxit_fd ]]; then
    _figxit_close
    return
  fi
  zle -F $fd 2>/dev/null
  exec {fd}>&-
}

_figxit_recv() {
  local line
  if [[ -n $2 ]] || ! IFS= read -r -u $1 line; then
    _figxit_drop $1
    return
  fi
  if [[ $line == Q$_figxit_sep* ]]; then
    _figxit_ask ${line#*$_figxit_sep}
    return
  fi
  _figxit_apply $line
}
