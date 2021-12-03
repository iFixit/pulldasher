import { extendTheme } from "@chakra-ui/react"

export const theme = extendTheme({
   components: {
      Status: {
         baseStyle: {
            display: "block",
            pos: "relative",
            w: "100%",
            height: "10px",
            opacity: 1,
            flexGrow: 1,
            transition: "opacity 0.3s ease-in-out",
            borderRadius: "5px",
         },
         variants: {
            pending: {
               bg: "var(--build-state-pending)",
            },
            success: {
               bg: "var(--build-state-success)",
               opacity: 0,
            },
            error: {
               bg: "var(--build-state-error)",
            },
            failure: {
               bg: "var(--build-state-failure)",
            },
         }
      }
   }
});
