_figxit_accept() {
  local line
  local -a f
  [[ "$CURSOR$_figxit_sep$BUFFER" == "$_figxit_last" ]] || return 1
  while IFS= read -r -t 0 -u $_figxit_fd line; do
    _figxit_apply $line
  done
  _figxit_send ${1:-A} || return 1
  while IFS= read -r -t 0.3 -u $_figxit_fd line; do
    f=("${(@ps:$_figxit_sep:)line}")
    if [[ $f[1] == A ]]; then
      (( f[2] < 0 )) && return 1
      (( f[2] > 0 )) && LBUFFER=${LBUFFER[1,-f[2]-1]}
      LBUFFER+=$f[3]
      _figxit_go=${f[4]:-0}
      return 0
    fi
    _figxit_apply $line
  done
  return 1
}

_figxit_fallback() {
  if (( _figxit_depth )); then
    zle ${_figxit_base[$1]:-$2}
    return
  fi
  _figxit_depth=1
  { zle ${_figxit_orig[$1]:-$2} } always { _figxit_depth=0 }
}

figxit-tab() {
  (( _figxit_visible && ! _figxit_depth )) && _figxit_accept && return
  _figxit_hold
  _figxit_fallback figxit-tab expand-or-complete
}

figxit-enter() {
  if (( _figxit_visible && ! _figxit_depth )) && _figxit_accept "R${_figxit_sep}1"; then
    (( _figxit_go )) || return 0
  fi
  _figxit_fallback figxit-enter accept-line
}

_figxit_recalled() {
  _figxit_last="$CURSOR$_figxit_sep$BUFFER"
  _figxit_send N
  return $1
}

figxit-up() {
  (( _figxit_visible && ! _figxit_depth )) && _figxit_send "K${_figxit_sep}up" && return
  _figxit_fallback figxit-up up-line-or-history
  _figxit_recalled $?
}

figxit-down() {
  (( _figxit_visible && ! _figxit_depth )) && _figxit_send "K${_figxit_sep}down" && return
  _figxit_fallback figxit-down down-line-or-history
  _figxit_recalled $?
}

figxit-esc() {
  if (( _figxit_visible && ! _figxit_depth )); then
    _figxit_send "K${_figxit_sep}esc"
    [[ ${_figxit_orig[figxit-esc]:-undefined-key} == undefined-key ]] && return
  fi
  _figxit_fallback figxit-esc beep
}
