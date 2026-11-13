_figxit_aliases() {
  [[ -n $_figxit_out ]] || return 0
  local name value list=
  for name in "${!BASH_ALIASES[@]}"; do
    value=${BASH_ALIASES[$name]}
    [[ $name$value == *[$'\n\x1e\x1f']* ]] || list+=${list:+$'\x1e'}$name=$value
  done
  [[ $1 != 1 && $list == "$_figxit_alias_state" ]] && return 0
  _figxit_send "U${_figxit_sep}${list}" && _figxit_alias_state=$list
}

_figxit_close() {
  [[ -n $_figxit_out ]] || return 0
  _figxit_alias_state=
  exec {_figxit_out}>&- {_figxit_in}<&-
  _figxit_out= _figxit_in= _figxit_pid=
  _figxit_visible=0
}

_figxit_send() {
  [[ -n $_figxit_out ]] || return 1
  if ! kill -0 "$_figxit_pid" 2>/dev/null; then
    _figxit_close
    return 1
  fi
  (( _figxit_trap )) && trap '' PIPE
  printf '%s\n' "$1" >&"$_figxit_out" 2>/dev/null || _figxit_close
  (( _figxit_trap )) && trap - PIPE
  [[ -n $_figxit_out ]]
}

_figxit_command() {
  if [[ -n $FIGXIT_BRIDGE ]]; then
    read -r -a _figxit_run <<<"$FIGXIT_BRIDGE"
  elif [[ -n $FIGXIT_APP ]]; then
    _figxit_run=("$FIGXIT_APP/Contents/MacOS/figxit-engine" bridge)
  elif [[ -f $FIGXIT_HOME/engine/src/main.ts ]] && type -P bun >/dev/null; then
    _figxit_run=(bun run "$FIGXIT_HOME/engine/src/main.ts" bridge)
  elif [[ -x $FIGXIT_HOME/dist/Figxit.app/Contents/MacOS/figxit-engine ]]; then
    _figxit_run=("$FIGXIT_HOME/dist/Figxit.app/Contents/MacOS/figxit-engine" bridge)
  fi
}

_figxit_open() {
  [[ -n $_figxit_out ]] && return 0
  (( EPOCHSECONDS < _figxit_retry )) && return 1
  _figxit_retry=$(( EPOCHSECONDS + 3 ))
  (( ${#_figxit_run[@]} )) || _figxit_command
  (( ${#_figxit_run[@]} )) || return 1
  [[ -z ${_figxit_co_PID-} ]] || return 1
  coproc _figxit_co { FIGXIT_HOME=$FIGXIT_HOME exec "${_figxit_run[@]}"; } 2>/dev/null
  [[ -n ${_figxit_co[1]-} ]] || return 1
  _figxit_pid=$_figxit_co_PID
  exec {_figxit_out}>&"${_figxit_co[1]}" {_figxit_in}<&"${_figxit_co[0]}"
  disown "$_figxit_pid" 2>/dev/null
  _figxit_send "H${_figxit_sep}$$${_figxit_sep}${TMUX%%,*}${_figxit_sep}${TMUX_PANE}${_figxit_sep}${PATH}${_figxit_sep}${TERM_PROGRAM}${_figxit_sep}${HERDR_PANE_ID}${_figxit_sep}${HERDR_SOCKET_PATH}${_figxit_sep}${HERDR_BIN_PATH}${_figxit_sep}1"
  _figxit_aliases 1
}

_figxit_apply() {
  [[ $1 == S"$_figxit_sep"* ]] && _figxit_visible=${1#*"$_figxit_sep"}
}

_figxit_drain() {
  local line
  [[ -n $_figxit_in ]] || return 0
  while read -r -t 0 -u "$_figxit_in"; do
    if ! IFS= read -r -t 0.05 -u "$_figxit_in" line; then
      _figxit_close
      return 0
    fi
    _figxit_apply "$line"
  done
}
