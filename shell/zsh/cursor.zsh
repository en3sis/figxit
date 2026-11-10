_figxit_ask() {
  if [[ -n $_figxit_asked ]]; then
    if (( EPOCHREALTIME - _figxit_asked_at < _figxit_wait )); then
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
  local ask=$'\e[c\e[6n\e[5n'
  if [[ "$COLUMNS $LINES" != $_figxit_size ]]; then
    _figxit_size="$COLUMNS $LINES"
    _figxit_cell=
    ask=$'\e[c\e[14t\e[16t\e[6n\e[5n'
    [[ $TERM_PROGRAM == iTerm.app ]] && ask=$'\e[c\e[14t\e[16t\e]1337;ReportCellSize\a\e[6n\e[5n'
  fi
  _figxit_asked=$1
  _figxit_asked_at=$EPOCHREALTIME
  print -n -- $ask >/dev/tty
}

_figxit_report() {
  emulate -L zsh
  setopt extendedglob
  local got= c row= col= seq=$_figxit_asked done=
  local -a match mbegin mend
  local -A size
  local -F stop=$(( EPOCHREALTIME + _figxit_wait ))
  _figxit_asked=
  while (( EPOCHREALTIME < stop )); do
    read -s -k 1 -t 0.02 c || continue
    got+=$c
    if [[ $got == *$'\e[0n' ]]; then
      done=1
      break
    fi
  done
  if [[ -z $got ]]; then
    _figxit_reports=0
    return 0
  fi
  got=${${got#($'\e[?'|)[0-9\;]#c}%$'\e[0n'}
  [[ -n $done ]] || got=${got%%$'\e'(\[[0-9\;\?]#|)}
  if [[ $got == (#b)(*)$'\e['(<->)';'(<->)R(*) ]]; then
    row=$match[2] col=$match[3] got=$match[1]$match[4]
  fi
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
  if [[ -z $row ]]; then
    [[ -n $done ]] && _figxit_reports=0
    [[ -n $seq ]] && _figxit_send "C${_figxit_sep}${seq}"
    return 0
  fi
  _figxit_reports=1
  [[ -n $seq ]] || return 0
  _figxit_send "C${_figxit_sep}${seq}${_figxit_sep}${row}${_figxit_sep}${col}${_figxit_sep}${COLUMNS}${_figxit_sep}${LINES}${_figxit_sep}${_figxit_cell}"
}

figxit-report() {
  local REPLY
  _figxit_report
  [[ -n $REPLY ]] && zle -U -- $REPLY
  return 0
}

figxit-report-end() {
  return 0
}
