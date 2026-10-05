[[ -o interactive ]] || return 0
zmodload zsh/net/socket zsh/datetime 2>/dev/null || return 0
autoload -Uz add-zle-hook-widget add-zsh-hook

typeset -g FIGXIT_HOME=${FIGXIT_HOME:-${${(%):-%x}:A:h:h:h}}
typeset -g _figxit_sock=${FIGXIT_SOCK:-$HOME/.local/state/figxit/engine.sock}
typeset -g _figxit_sep=$'\x1f'
(( $+functions[_figxit_close] )) && _figxit_close
typeset -g _figxit_fd=
typeset -g _figxit_last=
typeset -gi _figxit_visible=0 _figxit_retry=0 _figxit_depth=0
typeset -gA _figxit_orig _figxit_base
typeset -gA _figxit_keys=(
  '"^I"' figxit-tab
  '"^[[A"' figxit-up
  '"^[OA"' figxit-up
  '"^[[B"' figxit-down
  '"^[OB"' figxit-down
)

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
  zle -F $_figxit_fd _figxit_recv
  _figxit_send "H${_figxit_sep}$$${_figxit_sep}${TMUX%%,*}${_figxit_sep}${TMUX_PANE}${_figxit_sep}${PATH}"
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
  _figxit_apply $line
}

_figxit_accept() {
  local line
  local -a f
  _figxit_send A || return 1
  while IFS= read -r -t 0.3 -u $_figxit_fd line; do
    f=("${(@ps:$_figxit_sep:)line}")
    if [[ $f[1] == A ]]; then
      (( f[2] < 0 )) && return 1
      (( f[2] > 0 )) && LBUFFER=${LBUFFER[1,-f[2]-1]}
      LBUFFER+=$f[3]
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
  _figxit_fallback figxit-tab expand-or-complete
}

figxit-up() {
  if (( _figxit_visible && ! _figxit_depth )); then
    _figxit_send "K${_figxit_sep}up"
    return
  fi
  _figxit_fallback figxit-up up-line-or-history
}

figxit-down() {
  if (( _figxit_visible && ! _figxit_depth )); then
    _figxit_send "K${_figxit_sep}down"
    return
  fi
  _figxit_fallback figxit-down down-line-or-history
}

_figxit_bind() {
  local line key widget ours
  for line in ${(f)"$(bindkey -M main)"}; do
    key=${line%% *}
    ours=$_figxit_keys[$key]
    [[ -n $ours ]] || continue
    widget=${line##* }
    [[ $widget == "$ours" ]] && continue
    [[ -n $_figxit_base[$ours] ]] || _figxit_base[$ours]=$widget
    _figxit_orig[$ours]=$widget
    bindkey -M main ${(Q)key} $ours
  done
}

_figxit_line_init() {
  _figxit_last=
  _figxit_visible=0
  _figxit_connect || return 0
  _figxit_bind
  _figxit_send L
}

_figxit_redraw() {
  if [[ -z $_figxit_fd ]]; then
    _figxit_connect || return 0
    _figxit_bind
  fi
  (( PENDING )) && return 0
  local state="$CURSOR$_figxit_sep$BUFFER"
  [[ $state == "$_figxit_last" ]] && return 0
  _figxit_last=$state
  _figxit_send "E${_figxit_sep}${CURSOR}${_figxit_sep}${PWD}${_figxit_sep}${BUFFER//$'\n'/$'\x1e'}"
}

_figxit_preexec() {
  _figxit_visible=0
  _figxit_send X
  return 0
}

_figxit_hook() {
  local hook=zle-$1
  local -a extant
  zstyle -g extant $hook widgets
  if [[ -n $widgets[$hook] && $widgets[$hook] != user:azhw:$hook ]] && (( $#extant )); then
    [[ -n ${(M)extant:#(<->:|)$2} ]] && return 0
    zle -N -- $2
    zstyle -- $hook widgets $extant 90:$2
  else
    add-zle-hook-widget $1 $2
  fi
}

zle -N figxit-tab
zle -N figxit-up
zle -N figxit-down
_figxit_hook line-init _figxit_line_init
_figxit_hook line-pre-redraw _figxit_redraw
add-zsh-hook preexec _figxit_preexec
