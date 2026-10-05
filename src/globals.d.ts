/// <reference types="css-module-types" />

declare module '*.scss' {
  const content: Record<string, string>
  export default content
}

declare module '*.css' {
  const content: Record<string, string>
  export default content
}

type TyporaNativeContextMenuBridge = {
  setItems: (items: string[]) => unknown
}

interface Window {
  bridge?: {
    callSync?: (method: string, ...args: unknown[]) => unknown
  }
  JSBridge?: {
    contextMenu?: TyporaNativeContextMenuBridge
  }
  __TMT_NATIVE_MENU_BRIDGE__?: string
  __TMT_NATIVE_MENU_ACTION__?: (action: string) => string
}
