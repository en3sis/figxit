_figxit_bind_esc() {
  local widget=$(bindkey -M main '\e')
  widget=${widget##* }
  [[ $widget == figxit-esc ]] && return 0
  [[ -n $_figxit_base[figxit-esc] ]] || _figxit_base[figxit-esc]=$widget
  _figxit_orig[figxit-esc]=$widget
  bindkey -M main '\e' figxit-esc
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
  _figxit_bind_esc
  bindkey -M main '^[[?' figxit-report
}

_figxit_keytimeout() {
  _figxit_timed=1
  (( KEYTIMEOUT == 40 )) || return 0
  local map line re='^"([^"^\\]|\\[\\^"])([^"\\]|\\.)+" '
  for map in viins emacs; do
    for line in ${(f)"$(bindkey -M $map)"}; do
      [[ $line =~ $re ]] && return 0
    done
  done
  KEYTIMEOUT=5
}
