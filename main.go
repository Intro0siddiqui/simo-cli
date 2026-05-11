package main

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var port int

func main() {
	rootCmd.Execute()
}

func getSimoDir() string {
	usr, err := user.Current()
	var dir string
	if err == nil {
		dir = filepath.Join(usr.HomeDir, ".simo")
	} else {
		dir = filepath.Join(os.TempDir(), ".simo")
	}
	os.MkdirAll(dir, 0755)
	return dir
}

var rootCmd = &cobra.Command{
	Use:   "simo",
	Short: "Simo CLI — Agentic Browser Control Orchestrator",
	Long:  `A native Go backend for the Simo extension.`,
}

var (
	jsonFlag        bool
	interactiveFlag bool
	waitFlag        bool
	verifyFlag      bool
	timeoutFlag     int
	outputFlag      string
	refFlag         string
)

func init() {
	rootCmd.PersistentFlags().IntVarP(&port, "port", "p", 8765, "port for the relay server")

	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(runServeCmd)
	rootCmd.AddCommand(stopCmd)

	statusCmd := &cobra.Command{Use: "status", Short: "Show open browser tabs", Run: func(cmd *cobra.Command, args []string) { runClientStatus(port, jsonFlag) }}
	statusCmd.Flags().BoolVar(&jsonFlag, "json", false, "Output as JSON")
	rootCmd.AddCommand(statusCmd)

	navCmd := &cobra.Command{Use: "nav [tabId] [url]", Short: "Navigate tab to URL", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientNav(port, id, args[1])
	}}
	rootCmd.AddCommand(navCmd)

	openCmd := &cobra.Command{Use: "open [url]", Short: "Open new tab", Args: cobra.MaximumNArgs(1), Run: func(cmd *cobra.Command, args []string) {
		u := "about:blank"
		if len(args) > 0 {
			u = args[0]
		}
		runClientOpen(port, u)
	}}
	rootCmd.AddCommand(openCmd)

	snapCmd := &cobra.Command{Use: "snap [tabId]", Short: "Get accessibility snapshot", Args: cobra.ExactArgs(1), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientSnap(port, id, refFlag, interactiveFlag)
	}}
	snapCmd.Flags().StringVar(&refFlag, "ref", "", "Zoom into a specific ref")
	snapCmd.Flags().BoolVar(&interactiveFlag, "only-interactive", false, "Only show interactive elements")
	rootCmd.AddCommand(snapCmd)

	waitTextCmd := &cobra.Command{Use: "wait-text [tabId] [text]", Short: "Wait for text to appear", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientWaitText(port, id, args[1], timeoutFlag)
	}}
	waitTextCmd.Flags().IntVar(&timeoutFlag, "timeout", 10000, "Timeout in ms")
	rootCmd.AddCommand(waitTextCmd)

	waitCmd := &cobra.Command{Use: "wait [tabId] [ref]", Short: "Wait for element", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientWait(port, id, args[1], timeoutFlag)
	}}
	waitCmd.Flags().IntVar(&timeoutFlag, "timeout", 10000, "Timeout in ms")
	rootCmd.AddCommand(waitCmd)

	clickCmd := &cobra.Command{Use: "click [tabId] [ref]", Short: "Click element by ref", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientClick(port, id, args[1], waitFlag, verifyFlag)
	}}
	clickCmd.Flags().BoolVar(&waitFlag, "wait", false, "Wait for element before clicking")
	clickCmd.Flags().BoolVar(&verifyFlag, "verify", false, "Verify if click updated state")
	rootCmd.AddCommand(clickCmd)

	hoverCmd := &cobra.Command{Use: "hover [tabId] [ref]", Short: "Hover over element", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientHover(port, id, args[1], waitFlag)
	}}
	hoverCmd.Flags().BoolVar(&waitFlag, "wait", false, "Wait for element before hovering")
	rootCmd.AddCommand(hoverCmd)

	typeCmd := &cobra.Command{Use: "type [tabId] [ref] [text]", Short: "Type text into element", Args: cobra.ExactArgs(3), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientType(port, id, args[1], args[2], waitFlag)
	}}
	typeCmd.Flags().BoolVar(&waitFlag, "wait", false, "Wait for element before typing")
	rootCmd.AddCommand(typeCmd)

	shotCmd := &cobra.Command{Use: "shot [tabId]", Short: "Take a screenshot", Args: cobra.ExactArgs(1), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientShot(port, id, outputFlag)
	}}
	shotCmd.Flags().StringVarP(&outputFlag, "output", "o", "screenshot.png", "Output file path")
	rootCmd.AddCommand(shotCmd)

	rawClickCmd := &cobra.Command{Use: "raw-click [tabId] [x] [y]", Short: "Raw CDP click at coordinates", Args: cobra.ExactArgs(3), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		x, _ := strconv.Atoi(args[1])
		y, _ := strconv.Atoi(args[2])
		runClientRawClick(port, id, x, y)
	}}
	rootCmd.AddCommand(rawClickCmd)

	dragCmd := &cobra.Command{Use: "drag [tabId] [from] [to]", Short: "Drag element", Args: cobra.ExactArgs(3), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientDrag(port, id, args[1], args[2])
	}}
	rootCmd.AddCommand(dragCmd)

	gridCmd := &cobra.Command{Use: "grid [tabId] [gridRef] [query]", Short: "Solve a grid", Args: cobra.ExactArgs(3), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientGrid(port, id, args[1], args[2])
	}}
	rootCmd.AddCommand(gridCmd)

	scrollCmd := &cobra.Command{Use: "scroll [tabId] [delta]", Short: "Scroll the page", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		delta, _ := strconv.Atoi(args[1])
		runClientScroll(port, id, delta, refFlag)
	}}
	scrollCmd.Flags().StringVar(&refFlag, "ref", "", "Optional ref to scroll inside")
	rootCmd.AddCommand(scrollCmd)

	execCmd := &cobra.Command{Use: "exec [tabId] [code]", Short: "Run JS code", Args: cobra.ExactArgs(2), Run: func(cmd *cobra.Command, args []string) {
		id, _ := strconv.Atoi(args[0])
		runClientExec(port, id, args[1])
	}}
	rootCmd.AddCommand(execCmd)
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the WebSocket relay server in the background",
	Run: func(cmd *cobra.Command, args []string) {
		simoDir := getSimoDir()
		logFile := filepath.Join(simoDir, "relay.log")
		pidFile := filepath.Join(simoDir, "relay.pid")

		if pidBytes, err := os.ReadFile(pidFile); err == nil {
			pid, _ := strconv.Atoi(string(pidBytes))
			process, err := os.FindProcess(pid)
			if err == nil && process.Signal(syscall.Signal(0)) == nil {
				color.Yellow("[Simo] Relay server is already running (PID %d)", pid)
				return
			}
		}

		color.Cyan("[Simo] Starting native Go relay server on ws://127.0.0.1:%d...", port)

		ex, _ := os.Executable()
		c := exec.Command(ex, "run-serve", strconv.Itoa(port))

		outFile, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
		if err == nil {
			c.Stdout = outFile
			c.Stderr = outFile
		}

		err = c.Start()
		if err != nil {
			color.Red("Failed to start server: %v", err)
			return
		}

		os.WriteFile(pidFile, []byte(strconv.Itoa(c.Process.Pid)), 0644)

		color.Green("[Simo] Server started in background (PID %d).", c.Process.Pid)
		color.Yellow("Logs: %s", logFile)
	},
}

// Internal command to actually run the server process
var runServeCmd = &cobra.Command{
	Use:    "run-serve [port]",
	Hidden: true,
	Run: func(cmd *cobra.Command, args []string) {
		p := 8765
		if len(args) > 0 {
			p, _ = strconv.Atoi(args[0])
		}
		startServer(p)
	},
}

var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the background relay server",
	Run: func(cmd *cobra.Command, args []string) {
		simoDir := getSimoDir()
		pidFile := filepath.Join(simoDir, "relay.pid")

		pidBytes, err := os.ReadFile(pidFile)
		if err != nil {
			color.Yellow("[Simo] Relay server is not running (no pid file found).")
			return
		}

		pid, _ := strconv.Atoi(string(pidBytes))
		process, err := os.FindProcess(pid)
		if err == nil {
			err = process.Kill()
			if err == nil {
				color.Green("[Simo] Stopped relay server (PID %d).", pid)
			} else {
				color.Red("[Simo] Failed to stop process: %v", err)
			}
		}
		os.Remove(pidFile)
	},
}
