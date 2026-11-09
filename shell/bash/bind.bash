_figxit_bind() {
  local map=$1 tag=${1:0:1} line key value id=0 name
  local -A function macro command
  local -A nav=(['\C-i']=tab ['\C-m']=enter ['\C-j']=enter ['\e[A']='move up' ['\eOA']='move up' ['\e[B']='move down' ['\eOB']='move down')
  local edit=' \C-? \C-h \C-w \C-u \C-k \C-y \C-_ \C-b \C-f \C-a \C-e \C-p \C-n \e[C \e[D \eOC \eOD \e[H \e[F \eOH \eOF \e[3~ \e\C-? \e\C-h \ed \eb \ef '
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":\ (.+)$ ]] && function[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m "$map" -p)
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":\ \"(.*)\"$ ]] && macro[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m "$map" -s)
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":?\ \"(.*)\"$ ]] && command[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m "$map" -X)

  bind -m "$map" -x '"\C-x\C-_h": _figxit_hook'
  bind -m "$map" '"\C-x\C-_p": ""'
  for key in "${!function[@]}"; do
    value=${function[$key]}
    if [[ $value == self-insert && ( ${#key} == 1 || $key == '\"' || $key == '\\' ) ]]; then
      bind -m "$map" "\"\\C-x\\C-_s$key\": self-insert"
      bind -m "$map" "\"$key\": \"\\C-x\\C-_s$key\\C-x\\C-_h\""
    elif [[ $edit == *" $key "* ]]; then
      printf -v name 'f%02d' $(( id++ ))
      bind -m "$map" "\"\\C-x\\C-_$name\": $value"
      bind -m "$map" "\"$key\": \"\\C-x\\C-_$name\\C-x\\C-_h\""
    fi
  done

  id=0
  for key in "${!nav[@]}"; do
    name=$tag$(( id++ ))
    if [[ -n ${command[$key]+x} ]]; then
      _figxit_pass[$name]="bind -m $map -x '\"\\C-x\\C-_2$name\": \"${command[$key]//\'/\'\\\'\'}\"'"
    elif [[ -n ${macro[$key]+x} ]]; then
      [[ ${macro[$key]} == *'\C-x\C-_'* ]] && continue
      _figxit_pass[$name]="bind -m $map '\"\\C-x\\C-_2$name\": \"${macro[$key]//\'/\'\\\'\'}\"'"
    elif [[ -n ${function[$key]+x} ]]; then
      _figxit_pass[$name]="bind -m $map '\"\\C-x\\C-_2$name\": ${function[$key]}'"
    else
      _figxit_pass[$name]="bind -m $map '\"\\C-x\\C-_2$name\": \"\"'"
    fi
    _figxit_keymap[$name]=$map
    _figxit_route[$name]=
    _figxit_to "$name" pass
    set -- ${nav[$key]}
    bind -m "$map" -x "\"\\C-x\\C-_1$name\": _figxit_$1 $name $2"
    if [[ $1 == move ]]; then
      bind -m "$map" "\"$key\": \"\\C-x\\C-_1$name\\C-x\\C-_2$name\\C-x\\C-_h\""
    else
      bind -m "$map" "\"$key\": \"\\C-x\\C-_1$name\\C-x\\C-_2$name\""
    fi
  done

  if [[ $map == emacs ]]; then
    bind -m emacs -x "\"$(printf '\033')\": _figxit_esc"
  else
    bind -m "$map" -x '"\C-x\C-_e": _figxit_esc'
    bind -m "$map" "\"\\C-x\\C-_v\": ${function['\e']:-vi-movement-mode}"
    bind -m "$map" '"\e": "\C-x\C-_e\C-x\C-_v"'
  fi

  bind -m "$map" -x "\"\\C-x\\C-_r\": _figxit_report $map"
  bind -m "$map" '"\e[?": "\C-x\C-_r\C-x\C-_p"'
}

_figxit_bind_command() {
  local line key id=0
  local -A function
  while IFS= read -r line; do
    [[ $line =~ ^\"(.+)\":\ (.+)$ ]] && function[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < <(bind -m vi-command -p)
  bind -m vi-command -x '"\C-x\C-_d": _figxit_done'
  for key in '\C-m' '\C-j'; do
    [[ -n ${function[$key]+x} ]] || continue
    bind -m vi-command "\"\\C-x\\C-_a$id\": ${function[$key]}"
    bind -m vi-command "\"$key\": \"\\C-x\\C-_d\\C-x\\C-_a$(( id++ ))\""
  done
  bind -m vi-command -x '"\C-x\C-_r": _figxit_report vi-command'
  bind -m vi-command '"\C-x\C-_p": ""'
  bind -m vi-command '"\e[?": "\C-x\C-_r\C-x\C-_p"'
}

_figxit_keytimeout() {
  local map line re='^"([^\"]|\\[\"])([^\"]|\\.)+":? '
  [[ $(bind -v) == *'keyseq-timeout 500'* ]] || return 0
  for map in emacs vi-insert; do
    while IFS= read -r line; do
      [[ $line =~ $re ]] && return 0
    done < <(bind -m "$map" -p; bind -m "$map" -s; bind -m "$map" -X)
  done
  bind 'set keyseq-timeout 50'
}
