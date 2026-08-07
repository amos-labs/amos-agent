on run argv
  set sourcePath to item 1 of argv
  tell application "Keynote"
    activate
    open POSIX file sourcePath
    delay 4
    set deckDocument to front document
    set slideRef to slide 10 of deckDocument
    set outputLines to {}
    repeat with textRef in every text item of slideRef
      try
        set end of outputLines to ((object text of textRef as text) & " | pos=" & (position of textRef as text) & " | size=" & (width of textRef as text) & "x" & (height of textRef as text))
      end try
    end repeat
    close deckDocument saving no
    return outputLines
  end tell
end run
