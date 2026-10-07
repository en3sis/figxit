[[ $- == *i* ]] || return 0
[[ -z ${_figxit_sep-} ]] || return 0
if (( BASH_VERSINFO[0] < 5 )); then
  echo "figxit: bash 5 or later is needed, this shell is bash $BASH_VERSION" >&2
  return 0
fi

FIGXIT_HOME=${FIGXIT_HOME:-$(cd "${BASH_SOURCE[0]%/*}/../.." 2>/dev/null && pwd -P)}
_figxit_sep=$'\x1f'
_figxit_out= _figxit_in= _figxit_pid= _figxit_last= _figxit_cell=
_figxit_visible=0 _figxit_retry=0 _figxit_bound=0 _figxit_pushed=0 _figxit_trap=1
_figxit_plain=1
[[ -n $TMUX && -n $TMUX_PANE ]] && _figxit_plain=0
_figxit_run=()
declare -A _figxit_pass _figxit_route
_figxit_eat=

_figxit_close() {
  [[ -n $_figxit_out ]] || return 0
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
  _figxit_send "H${_figxit_sep}$$${_figxit_sep}${TMUX%%,*}${_figxit_sep}${TMUX_PANE}${_figxit_sep}${PATH}${_figxit_sep}${TERM_PROGRAM}"
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

_figxit_unpush() {
  (( _figxit_pushed )) || return 0
  _figxit_pushed=0
  bind -m emacs '"\C-x\C-_p": ""'
}

_figxit_hook() {
  _figxit_unpush
  [[ -n $_figxit_out ]] || return 0
  read -t 0 && return 0
  local state="$READLINE_POINT$_figxit_sep$READLINE_LINE"
  [[ $state == "$_figxit_last" ]] && return 0
  _figxit_last=$state
  _figxit_send "E${_figxit_sep}${READLINE_POINT}${_figxit_sep}${PWD}${_figxit_sep}${READLINE_LINE//$'\n'/$'\x1e'}"
}

_figxit_read() {
  local LC_ALL=C got= row= col= size4= size6=
  local cpr=$'^(.*)\e\\[([0-9]+);([0-9]+)$' size=$'^(.*)\e\\[([46]);([0-9]+);([0-9]+)t(.*)$'
  IFS= read -rs -d R -t 0.1 got
  if [[ $got =~ $cpr ]]; then
    got=${BASH_REMATCH[1]} row=${BASH_REMATCH[2]} col=${BASH_REMATCH[3]}
  fi
  [[ $got =~ ^($'\e'\[\?)?[0-9\;]*c(.*)$ ]] && got=${BASH_REMATCH[2]}
  while [[ $got =~ $size ]]; do
    if [[ ${BASH_REMATCH[2]} == 4 ]]; then
      size4="${BASH_REMATCH[3]}${_figxit_sep}${BASH_REMATCH[4]}"
    else
      size6="${BASH_REMATCH[3]}${_figxit_sep}${BASH_REMATCH[4]}"
    fi
    got=${BASH_REMATCH[1]}${BASH_REMATCH[5]}
  done
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
    bind -m emacs "\"\\C-x\\C-_p\": \"$keys\""
    _figxit_pushed=1
  fi
  _figxit_hook
}

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
    bind -m emacs "\"\\C-x\\C-_2$1\": \"\""
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
  local line=
  if _figxit_accept R; then
    _figxit_to "$1" eat
    _figxit_hook
    return
  fi
  _figxit_to "$1" pass
  _figxit_visible=0
  _figxit_last=
  _figxit_send X || return 0
  (( _figxit_plain )) || return 0
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
  fi
}

_figxit_esc() {
  _figxit_unpush
  _figxit_drain
  (( _figxit_visible )) && _figxit_send "K${_figxit_sep}esc"
}

_figxit_bind() {
  local line key value id=0 name
  local -A function macro command
  local -A nav=(['\C-i']=tab ['\C-m']=enter ['\C-j']=enter ['\e[A']='move up' ['\eOA']='move up' ['\e[B']='move down' ['\eOB']='move down')
  local edit=' \C-? \C-h \C-w \C-u \C-k \C-y \C-b \C-f \C-a \C-e \C-p \C-n \e[C \e[D \eOC \eOD \e[H \e[F \eOH \eOF \e[3~ \e\C-? \e\C-h \ed \eb \ef '
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":\ (.+)$ ]] && function[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m emacs -p)
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":\ \"(.*)\"$ ]] && macro[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m emacs -s)
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":?\ \"(.*)\"$ ]] && command[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m emacs -X)

  bind -m emacs -x '"\C-x\C-_h": _figxit_hook'
  bind -m emacs '"\C-x\C-_p": ""'
  for key in "${!function[@]}"; do
    value=${function[$key]}
    if [[ $value == self-insert && ( ${#key} == 1 || $key == '\"' || $key == '\\' ) ]]; then
      bind -m emacs "\"\\C-x\\C-_s$key\": self-insert"
      bind -m emacs "\"$key\": \"\\C-x\\C-_s$key\\C-x\\C-_h\""
    elif [[ $edit == *" $key "* ]]; then
      printf -v name 'f%02d' $(( id++ ))
      bind -m emacs "\"\\C-x\\C-_$name\": $value"
      bind -m emacs "\"$key\": \"\\C-x\\C-_$name\\C-x\\C-_h\""
    fi
  done

  id=0
  for key in "${!nav[@]}"; do
    name=$(( id++ ))
    if [[ -n ${command[$key]+x} ]]; then
      _figxit_pass[$name]="bind -m emacs -x '\"\\C-x\\C-_2$name\": \"${command[$key]//\'/\'\\\'\'}\"'"
    elif [[ -n ${macro[$key]+x} ]]; then
      [[ ${macro[$key]} == *'\C-x\C-_'* ]] && continue
      _figxit_pass[$name]="bind -m emacs '\"\\C-x\\C-_2$name\": \"${macro[$key]//\'/\'\\\'\'}\"'"
    elif [[ -n ${function[$key]+x} ]]; then
      _figxit_pass[$name]="bind -m emacs '\"\\C-x\\C-_2$name\": ${function[$key]}'"
    else
      _figxit_pass[$name]="bind -m emacs '\"\\C-x\\C-_2$name\": \"\"'"
    fi
    _figxit_route[$name]=
    _figxit_to "$name" pass
    set -- ${nav[$key]}
    bind -m emacs -x "\"\\C-x\\C-_1$name\": _figxit_$1 $name $2"
    if [[ $1 == move ]]; then
      bind -m emacs "\"$key\": \"\\C-x\\C-_1$name\\C-x\\C-_2$name\\C-x\\C-_h\""
    else
      bind -m emacs "\"$key\": \"\\C-x\\C-_1$name\\C-x\\C-_2$name\""
    fi
  done

  bind -m emacs -x "\"$(printf '\033')\": _figxit_esc"

  if (( _figxit_plain )); then
    bind -m emacs -x '"\C-x\C-_r": _figxit_report'
    bind -m emacs '"\e[?": "\C-x\C-_r\C-x\C-_p"'
  fi
}

_figxit_prompt() {
  _figxit_last=
  _figxit_visible=0
  if (( ! _figxit_bound )); then
    _figxit_bound=1
    if shopt -q -o vi; then
      _figxit_bound=2
      echo "figxit: bash vi mode is not supported, the popup is off in this shell" >&2
    else
      [[ -n $(trap -p PIPE) ]] && _figxit_trap=0
      _figxit_bind
    fi
  fi
  (( _figxit_bound == 1 )) || return 0
  _figxit_open || return 0
  _figxit_drain
  _figxit_send L
  return 0
}

if [[ ${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(_figxit_prompt)
else
  PROMPT_COMMAND=${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_figxit_prompt
fi
