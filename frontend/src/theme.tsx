import { extendTheme } from "@chakra-ui/react";
import "./theme/base.less";
import "./theme/day_theme.less";
import "./theme/night_theme.less";

export const theme = extendTheme({
  initialColorMode: "light",
  useSystemColorMode: false,
  components: {
    Link: {
      baseStyle: {
        "&:hover": {
          textDecoration: "none",
        },
      },
    },
    Column: {
      baseStyle: {
        border: "1px solid var(--panel-default-border)",
        borderRadius: "7px",
        "& .column_header": {
          color: "var(--panel-default-text)",
          cursor: "pointer",
          background: "var(--panel-default-background)",
          fontSize: "1rem",
        },
        "& .pull_count": {
          minWidth: "50px",
          textAlign: "center",
          color: "var(--panel-default-count-text)",
          borderLeft: "solid 1px var(--panel-default-count-border)",
          background: "var(--panel-default-count-background)",
        },
      },
      variants: {
        ciBlocked: {
          borderColor: "var(--panel-ci-blocked-border)",
          "& .column_header": {
            background: "var(--panel-ci-blocked-background)",
            color: "var(--panel-ci-blocked-text)",
          },
          "& .pull_count": {
            color: "var(--panel-ci-blocked-count-text)",
            borderLeft: "solid 1px var(--panel-ci-blocked-count-border)",
            background: "var(--panel-ci-blocked-count-background)",
          },
        },
        deployBlocked: {
          borderColor: "var(--panel-deploy-blocked-border)",
          "& .column_header": {
            background: "var(--panel-deploy-blocked-background)",
            color: "var(--panel-deploy-blocked-text)",
          },
          "& .pull_count": {
            color: "var(--panel-deploy-blocked-count-text)",
            borderLeft: "solid 1px var(--panel-deploy-blocked-count-border)",
            background: "var(--panel-deploy-blocked-count-background)",
          },
        },
        ready: {
          borderColor: "var(--panel-ready-border)",
          "& .column_header": {
            background: "var(--panel-ready-background)",
            color: "var(--panel-ready-text)",
          },
          "& .pull_count": {
            color: "var(--panel-ready-count-text)",
            borderLeft: "solid 1px var(--panel-ready-count-border)",
            background: "var(--panel-ready-count-background)",
          },
        },
        closed: {
          borderRadius: "7px 0 0 7px",
          backgroundColor: "var(--background-color)",
          "& .column_header": {
            borderRadius: "7px 0 0 0",
          },
        },
      },
    },
    StatusGroup: {
      baseStyle: {
        display: "block",
        pos: "relative",
        w: "100%",
        opacity: 1,
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
      },
    },
    StatusLink: {
      baseStyle: {
        borderBottom: "1px solid var(--build-status-link-divider)",
        "&:last-child": {
          borderBottom: "none",
        },
        padding: "5px",
        "> span": {
          color: "var(--build-status-text)",
          marginLeft: "10px",
        },
        "&:hover": {
          background: "var(--build-status-hover)",
        },
      },
      variants: {
        pending: {
          color: "var(--build-state-pending)",
        },
        success: {
          color: "var(--build-state-success)",
        },
        error: {
          color: "var(--build-state-error)",
        },
        failure: {
          color: "var(--build-state-failure)",
        },
      },
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
      },
    },
    SignatureListItem: {
      baseStyle: {
        display: "block",
        color: "var(--build-status-text)",
        borderBottom: "1px solid var(--build-status-link-divider)",
        "&:last-child": {
          borderBottom: "none",
        },
        padding: "5px",
        "&:hover": {
          background: "var(--build-status-hover)",
        },
      },
    },
    PullFlag: {
      baseStyle: {
        py: "5px",
        px: "6px",
        lineHeight: "1em",
        borderRadius: "3px",
        fontSize: "18px",
        border: "solid 1px",
      },
      variants: {
        devBlock: {
          color: "var(--tag-dev-blocked)",
          backgroundColor: "var(--tag-dev-blocked-background)",
          borderColor: "var(--tag-dev-blocked-border)",
        },
        draftBlock: {
          color: "var(--tag-draft-blocked)",
          backgroundColor: "var(--tag-draft-blocked-background)",
          borderColor: "var(--tag-draft-blocked-border)",
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
        cryogenicStorage: {
          color: "var(--tag-cryo)",
          backgroundColor: "var(--tag-cryo-background)",
          borderColor: "var(--tag-cryo-border)",
        },
        mergeConflict: {
          color: "var(--tag-merge-conflict)",
          backgroundColor: "var(--tag-merge-conflict-background)",
          borderColor: "var(--tag-merge-conflict-border)",
        },
        dependentPR: {
          color: "var(--tag-dependent-pr)",
          backgroundColor: "var(--tag-dependent-pr-background)",
          borderColor: "var(--tag-dependent-pr-border)",
        },
      },
    },
  },
});
