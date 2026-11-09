_figxit_accept() {
  local line count text
  _figxit_unpush
  _figxit_drain
  (( _figxit_visible )) || return 1
  [[ "$READLINE_POINT$_figxit_sep$READLINE_LINE" == "$_figxit_last" ]] || return 1
  _figxit_send "$1" || return 1
  while IFS= read -r -t 0.3 -u "$_figxit_in" line; do
    if [[ $line == A"$_figxit_sep"* ]]; then
      line=${line#*"$_figxit_sep"}
      count=${line%%"$_figxit_sep"*}
      text=${line#*"$_figxit_sep"}
      (( count < 0 )) && return 1
      _figxit_go=0
      if [[ $text == *"$_figxit_sep"* ]]; then
        _figxit_go=${text##*"$_figxit_sep"}
        text=${text%"$_figxit_sep"*}
      fi
      READLINE_LINE="${READLINE_LINE:0:READLINE_POINT-count}${text}${READLINE_LINE:READLINE_POINT}"
      READLINE_POINT=$(( READLINE_POINT - count + ${#text} ))
      return 0
    fi
    _figxit_apply "$line"
  done
  return 1
}

_figxit_to() {
  [[ ${_figxit_route[$1]} == "$2" ]] && return 0
  _figxit_route[$1]=$2
  if [[ $2 == pass ]]; then
    eval "${_figxit_pass[$1]}"
  else
    bind -m "${_figxit_keymap[$1]}" "\"\\C-x\\C-_2$1\": \"\""
  fi
}

_figxit_tab() {
  if _figxit_accept A; then
    _figxit_to "$1" eat
    _figxit_hook
  else
    _figxit_to "$1" pass
  fi
}

_figxit_enter() {
  if _figxit_accept "R${_figxit_sep}1" && (( ! _figxit_go )); then
    _figxit_to "$1" eat
    _figxit_hook
    return
  fi
  _figxit_to "$1" pass
  _figxit_done
}

_figxit_done() {
  local line=
  _figxit_visible=0
  _figxit_last=
  _figxit_send X || return 0
  while IFS= read -r -t 0.05 -u "$_figxit_in" line; do
    [[ $line == Z"$_figxit_sep"* ]] && break
    _figxit_apply "$line"
  done
  [[ $line == "Z${_figxit_sep}1" ]] && _figxit_read
  _figxit_visible=0
}

_figxit_move() {
  _figxit_unpush
  _figxit_drain
  if (( _figxit_visible )) && _figxit_send "K${_figxit_sep}$2"; then
    _figxit_to "$1" eat
  else
    _figxit_to "$1" pass
    _figxit_recall=1
  fi
}

_figxit_esc() {
  _figxit_unpush
  _figxit_drain
  (( _figxit_visible )) && _figxit_send "K${_figxit_sep}esc"
}
