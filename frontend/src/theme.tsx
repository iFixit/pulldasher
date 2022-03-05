import { extendTheme } from "@chakra-ui/react"

export const theme = extendTheme({
   components: {
      Column: {
         baseStyle: {
            border: "1px solid var(--panel-default-border)",
            borderRadius: "7px",
            "& .column_header": {
               bg: "var(--panel-default-background)",
            },
            "& .pull_count": {
               color: "var(--panel-default-count-text)",
               borderLeft: "solid 1px var(--panel-default-count-border)",
               bg: "var(--panel-default-count-background)",
            }
         },
         variants: {
            "ciBlocked": {
               borderColor: "var(--panel-ci-blocked-border)",
               "& .column_header": {
                  bg: "var(--panel-ci-blocked-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-ci-blocked-count-text)",
                  borderLeft: "solid 1px var(--panel-ci-blocked-count-border)",
                  bg: "var(--panel-ci-blocked-count-background)",
               },
            },
            "deployBlocked": {
               borderColor: "var(--panel-deploy-blocked-border)",
               "& .column_header": {
                  bg: "var(--panel-deploy-blocked-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-deploy-blocked-count-text)",
                  borderLeft: "solid 1px var(--panel-deploy-blocked-count-border)",
                  bg: "var(--panel-deploy-blocked-background)",
               },
            },
            "ready": {
               borderColor: "var(--panel-ready-border)",
               "& .column_header": {
                  bg: "var(--panel-ready-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-ready-count-text)",
                  borderLeft: "solid 1px var(--panel-ready-count-border)",
                  bg: "var(--panel-ready-background)",
               },
            }
         }
      },
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
      },
      Signatures: {
         baseStyle: {
            fontSize: 14,
            fontWeight: 700,
            borderRadius: "3px",
            backgroundColor: "var(--status-background)",
            borderWidth: "1px",
            borderColor: "var(--status-border)",
            color: "var(--status-text)",
         },
         variants: {
            valid: {
               backgroundColor: "var(--status-valid-background)",
               borderColor: "var(--status-valid-border)",
               color: "var(--status-valid-text)",
            },
            validMine: {
               backgroundColor: "var(--status-valid-mine-background)",
               borderColor: "var(--status-valid-mine-border)",
               color: "var(--status-valid-mine-text)",
            },
         }
      }
   }
});
