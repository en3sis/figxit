_figxit_unpush() {
  [[ -n $_figxit_pushed ]] || return 0
  bind -m "$_figxit_pushed" '"\C-x\C-_p": ""'
  _figxit_pushed=
}

_figxit_read() {
  local LC_ALL=C got= part= row= col= size4= size6=
  local cpr=$'^(.*)\e\\[([0-9]+);([0-9]+)$' size=$'^(.*)\e\\[([46]);([0-9]+);([0-9]+)t(.*)$'
  local points=$'^(.*)\e\\]1337;ReportCellSize=([0-9.]+);([0-9.]+)(;[0-9.]+)?(\e\\\\|\a)(.*)$'
  while IFS= read -rs -d R -t 0.1 part; do
    got+=$part
    if [[ $got =~ $cpr ]]; then
      got=${BASH_REMATCH[1]} row=${BASH_REMATCH[2]} col=${BASH_REMATCH[3]}
      break
    fi
    got+=R
  done
  [[ -n $row ]] || got+=$part
  [[ $got =~ ^($'\e'\[\?)?[0-9\;]*c(.*)$ ]] && got=${BASH_REMATCH[2]}
  while [[ $got =~ $size ]]; do
    if [[ ${BASH_REMATCH[2]} == 4 ]]; then
      size4="${BASH_REMATCH[3]}${_figxit_sep}${BASH_REMATCH[4]}"
    else
      size6="${BASH_REMATCH[3]}${_figxit_sep}${BASH_REMATCH[4]}"
    fi
    got=${BASH_REMATCH[1]}${BASH_REMATCH[5]}
  done
  if [[ $got =~ $points ]]; then
    size6="${BASH_REMATCH[2]}${_figxit_sep}${BASH_REMATCH[3]}"
    got=${BASH_REMATCH[1]}${BASH_REMATCH[6]}
  fi
  [[ -n $size4$size6 ]] && _figxit_cell="${size6:-$_figxit_sep}${_figxit_sep}${size4}"
  REPLY=$got
  if [[ -z $row ]]; then
    _figxit_send c
  elif (( col == 1 && ${READLINE_POINT:-0} > 0 )); then
    _figxit_send "c${_figxit_sep}again"
  else
    _figxit_send "c${_figxit_sep}${row}${_figxit_sep}${col}${_figxit_sep}${COLUMNS}${_figxit_sep}${LINES}${_figxit_sep}${_figxit_cell}"
  fi
}

_figxit_report() {
  local REPLY LC_ALL=C keys= i byte
  _figxit_unpush
  _figxit_read
  if [[ -n $REPLY ]]; then
    for (( i = 0; i < ${#REPLY}; i++ )); do
      printf -v byte '%d' "'${REPLY:i:1}"
      printf -v byte '%03o' $(( byte & 255 ))
      keys+="\\$byte"
    done
    bind -m "$1" "\"\\C-x\\C-_p\": \"$keys\""
    _figxit_pushed=$1
  fi
  [[ $1 == vi-command ]] || _figxit_hook
}
