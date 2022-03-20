import { extendTheme } from "@chakra-ui/react"

export const theme = extendTheme({
   components: {
      Link: {
         baseStyle: {
            "&:hover": {
               textDecoration: "none",
            }
         }
      },
      Column: {
         baseStyle: {
            border: "1px solid var(--panel-default-border)",
            borderRadius: "7px",
            "& .column_header": {
               cursor: "pointer",
               background: "var(--panel-default-background)",
               fontSize: "1rem",
            },
            "& .pull_count": {
               color: "var(--panel-default-count-text)",
               borderLeft: "solid 1px var(--panel-default-count-border)",
               background: "var(--panel-default-count-background)",
            }
         },
         variants: {
            "ciBlocked": {
               borderColor: "var(--panel-ci-blocked-border)",
               "& .column_header": {
                  background: "var(--panel-ci-blocked-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-ci-blocked-count-text)",
                  borderLeft: "solid 1px var(--panel-ci-blocked-count-border)",
                  background: "var(--panel-ci-blocked-count-background)",
               },
            },
            "deployBlocked": {
               borderColor: "var(--panel-deploy-blocked-border)",
               "& .column_header": {
                  background: "var(--panel-deploy-blocked-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-deploy-blocked-count-text)",
                  borderLeft: "solid 1px var(--panel-deploy-blocked-count-border)",
                  background: "var(--panel-deploy-blocked-count-background)",
               },
            },
            "ready": {
               borderColor: "var(--panel-ready-border)",
               "& .column_header": {
                  background: "var(--panel-ready-background)",
               },
               "& .pull_count": {
                  color: "var(--panel-ready-count-text)",
                  borderLeft: "solid 1px var(--panel-ready-count-border)",
                  background: "var(--panel-ready-count-background)",
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
      },
      PullFlag: {
         baseStyle: {
            py: "5px",
            px: "6px",
            lineHeight: "1em",
            borderRadius: "3px",
            fontSize:"18px",
            border: "solid 1px",
         },
         variants: {
            devBlock: {
               color: "var(--tag-dev-blocked)",
               backgroundColor: "var(--tag-dev-blocked-background)",
               borderColor: "var(--tag-dev-blocked-border)",
            },
            deployBlock: {
               color: "var(--tag-deploy-blocked)",
               backgroundColor: "var(--tag-deploy-blocked-background)",
               borderColor: "var(--tag-deploy-blocked-border)",
            },
            QAing: {
               color: "var(--tag-qaing)",
               backgroundColor: "var(--tag-qaing-background)",
               borderColor: "var(--tag-qaing-border)",
            },
            externalBlock: {
               color: "var(--tag-externally-blocked)",
               backgroundColor: "var(--tag-externally-blocked-background)",
               borderColor: "var(--tag-externally-blocked-border)",
            },
         },
      },
   }
});
