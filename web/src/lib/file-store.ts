let _file: File | null = null

export function storeFile(file: File | null) {
  _file = file
}

export function getStoredFile(): File | null {
  return _file
}
