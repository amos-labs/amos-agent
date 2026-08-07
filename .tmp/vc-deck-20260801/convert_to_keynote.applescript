on run argv
  set sourcePath to item 1 of argv
  set keynotePath to item 2 of argv
  set pdfPath to item 3 of argv

  tell application "Keynote"
    activate
    set priorDocumentCount to count of documents
    open POSIX file sourcePath
    repeat 60 times
      if (count of documents) > priorDocumentCount then exit repeat
      delay 0.5
    end repeat
    if (count of documents) is not greater than priorDocumentCount then error "The unique import did not create a new Keynote document."
    delay 5
    set deckDocument to front document
    set importedDocumentName to name of deckDocument
    save deckDocument in POSIX file keynotePath as Keynote
    delay 5
    export deckDocument to POSIX file pdfPath as PDF
    delay 5
    close deckDocument saving no
    return {importedDocumentName, keynotePath, pdfPath}
  end tell
end run
