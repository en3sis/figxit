_figxit_ask() {
  if (( $funcstack[(I)_figxit_report] )); then
    _figxit_asked=$1
    return
  fi
  if [[ -n $_figxit_asked ]]; then
    if (( EPOCHREALTIME - _figxit_asked_at < _figxit_wait )); then
      _figxit_asked=$1
      return
    fi
    _figxit_asked=
    (( _figxit_seen )) || _figxit_reports=-1
  fi
  if (( _figxit_reports < 1 || PENDING )) || [[ $KEYMAP != main || -n $_figxit_typed ]]; then
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
  (( _figxit_seen && _figxit_ends )) || return 0
  local REPLY
  _figxit_report ask && return 0
  _figxit_ends=0
  kill -INT $$
}

_figxit_report() {
  emulate -L zsh
  setopt extendedglob
  local got= c row= col= seq= done= int=
  local -a match mbegin mend
  local -A size
  local -F stop=$(( EPOCHREALTIME + _figxit_wait ))
  [[ $1 == ask ]] && trap 'int+=.; (( $#int == 2 )) && stop=$(( EPOCHREALTIME + _figxit_wait )); print -n -- "\e[5n" >/dev/tty' INT
  while (( EPOCHREALTIME < stop )) || [[ $1 == ask && -n $got$int && $#int -lt 2 ]]; do
    read -s -k 1 -t 0.02 c || continue
    got+=$c
    if [[ $got == *$'\e[0n' ]]; then
      done=1
      break
    fi
    [[ $1 != drain && $got == *$'\e['<->';'<->R ]] && break
  done
  local -i heard=${#got}
  got=${got%$'\e[0n'}
  if [[ $1 == ask ]]; then
    got=${got/$'\e[?'[0-9\;]#c}
  else
    got=${got#($'\e[?'|)[0-9\;]#c}
  fi
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
  if [[ $1 == ask ]]; then
    if [[ -n $row && -z $REPLY$int ]]; then
      while { (( EPOCHREALTIME < stop )) || [[ -n $REPLY ]] } && (( $#int < 2 )); do
        read -s -k 1 -t 0.02 c && REPLY+=$c
        [[ $REPLY == *$'\e[0n' ]] && break
      done
      if [[ $REPLY == *$'\e[0n' ]]; then
        done=1 REPLY=${REPLY%$'\e[0n'}
      else
        _figxit_ends=0
      fi
    fi
    # zle -U in a -F handler lands after the next input byte
    [[ -n $REPLY$int ]] && [[ -n $done || -z $row ]] && print -n -- $'\e[5n' >/dev/tty
    _figxit_typed+=$REPLY REPLY=
  fi
  seq=$_figxit_asked
  _figxit_asked=
  if [[ -z $row ]]; then
    if [[ -n $done && -z $int ]] || (( ! heard && ! _figxit_seen )); then
      _figxit_reports=-1
    elif (( ! _figxit_seen )); then
      _figxit_reports=0
    fi
    [[ -n $seq ]] && _figxit_send "C${_figxit_sep}${seq}"
  else
    _figxit_reports=1 _figxit_seen=1
    [[ -n $seq ]] && _figxit_send "C${_figxit_sep}${seq}${_figxit_sep}${row}${_figxit_sep}${col}${_figxit_sep}${COLUMNS}${_figxit_sep}${LINES}${_figxit_sep}${_figxit_cell}"
  fi
  [[ -z $int ]]
}

_figxit_release() {
  [[ -n $_figxit_typed ]] && (( ! $funcstack[(I)_figxit_recv] )) || return 1
  zle -U -- "$_figxit_typed"
  _figxit_typed=
}

figxit-report() {
  local REPLY
  _figxit_report
  _figxit_typed+=$REPLY
  _figxit_release
  return 0
}

figxit-report-end() {
  _figxit_ends=1
  _figxit_release
  return 0
}
