_figxit_ask() {
  if [[ -n $_figxit_asked ]]; then
    if (( EPOCHREALTIME - _figxit_asked_at < 1 )); then
      _figxit_asked=$1
      return
    fi
    _figxit_asked=
    _figxit_reports=0
  fi
  if (( ! _figxit_reports || PENDING )) || [[ $KEYMAP != main ]]; then
    _figxit_send "C${_figxit_sep}$1"
    return
  fi
  local ask=$'\e[c\e[6n'
  if [[ "$COLUMNS $LINES" != $_figxit_size ]]; then
    _figxit_size="$COLUMNS $LINES"
    _figxit_cell=
    ask=$'\e[c\e[14t\e[16t\e[6n'
    [[ $TERM_PROGRAM == iTerm.app ]] && ask=$'\e[c\e[14t\e[16t\e]1337;ReportCellSize\a\e[6n'
  fi
  _figxit_asked=$1
  _figxit_asked_at=$EPOCHREALTIME
  print -n -- $ask >/dev/tty
}

_figxit_report() {
  emulate -L zsh
  setopt extendedglob
  local got= c row= col= seq=$_figxit_asked
  local -a match mbegin mend
  local -A size
  local -F stop=$(( EPOCHREALTIME + 0.1 ))
  while (( EPOCHREALTIME < stop )); do
    read -s -k 1 -t 0.02 c || continue
    got+=$c
    if [[ $got == (#b)(*)$'\e['(<->)';'(<->)R ]]; then
      got=$match[1] row=$match[2] col=$match[3]
      break
    fi
  done
  [[ $got == (#b)($'\e[?'|)[0-9\;]#c(*) ]] && got=$match[2]
  while [[ $got == (#b)(*)$'\e['([46])';'(<->)';'(<->)t(*) ]]; do
    size[$match[2]]="$match[3]${_figxit_sep}$match[4]"
    got=$match[1]$match[5]
  done
  if [[ $got == (#b)(*)$'\e]1337;ReportCellSize='([0-9.]##)';'([0-9.]##)(';'[0-9.]##|)($'\e\\'|$'\a')(*) ]]; then
    size[6]="$match[2]${_figxit_sep}$match[3]"
    got=$match[1]$match[6]
  fi
  (( $#size )) && _figxit_cell="${size[6]:-$_figxit_sep}${_figxit_sep}${size[4]}"
  REPLY=$got
  _figxit_asked=
  [[ -n $seq ]] || return 0
  if [[ -z $row ]]; then
    _figxit_reports=0
    _figxit_send "C${_figxit_sep}${seq}"
    return 0
  fi
  _figxit_send "C${_figxit_sep}${seq}${_figxit_sep}${row}${_figxit_sep}${col}${_figxit_sep}${COLUMNS}${_figxit_sep}${LINES}${_figxit_sep}${_figxit_cell}"
}

figxit-report() {
  local REPLY
  _figxit_report
  [[ -n $REPLY ]] && zle -U -- $REPLY
  return 0
}
