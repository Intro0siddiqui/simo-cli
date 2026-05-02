package main

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
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
	Long:  `A cross-platform Go wrapper for the Simo Python backend. Replacement for legacy shell scripts.`,
}

func init() {
	rootCmd.PersistentFlags().IntVarP(&port, "port", "p", 8765, "port for the relay server")

	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(stopCmd)
	rootCmd.AddCommand(statusCmd)
	
	// Dynamically wrap all other commands to observer.py
	rootCmd.AddCommand(wrapCmd("snap", "Get accessibility snapshot"))
	rootCmd.AddCommand(wrapCmd("shot", "Take screenshot"))
	rootCmd.AddCommand(wrapCmd("click", "Click element by ref"))
	rootCmd.AddCommand(wrapCmd("type", "Type text into element"))
	rootCmd.AddCommand(wrapCmd("hover", "Hover over element by ref"))
	rootCmd.AddCommand(wrapCmd("drag", "Drag element from one ref to another"))
	rootCmd.AddCommand(wrapCmd("nav", "Navigate tab to URL"))
	rootCmd.AddCommand(wrapCmd("open", "Open new tab"))
	rootCmd.AddCommand(wrapCmd("exec", "Execute JS code"))
	rootCmd.AddCommand(wrapCmd("grid", "Solve a grid of radio/checkboxes"))
	rootCmd.AddCommand(wrapCmd("scroll", "Scroll the page or an element"))
	rootCmd.AddCommand(wrapCmd("wait-text", "Wait for text to appear in the AXTree"))
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the WebSocket relay server in the background",
	Run: func(cmd *cobra.Command, args []string) {
		python := getPythonPath()
		base := getBasePath()
		serverScript := filepath.Join(base, "server.py")
		
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

		color.Cyan("[Simo] Starting relay server on ws://127.0.0.1:%d...", port)
		
		c := exec.Command(python, serverScript)
		
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

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show open browser tabs",
	Run: func(cmd *cobra.Command, args []string) {
		runObserver("status", args)
	},
}

func wrapCmd(name, short string) *cobra.Command {
	return &cobra.Command{
		Use:                name,
		Short:              short,
		DisableFlagParsing: true, // Pass everything to Python
		Run: func(cmd *cobra.Command, args []string) {
			runObserver(name, args)
		},
	}
}

func getBasePath() string {
	ex, err := os.Executable()
	if err != nil {
		return "."
	}
	evalPath, err := filepath.EvalSymlinks(ex)
	if err == nil {
		return filepath.Dir(evalPath)
	}
	return filepath.Dir(ex)
}

func getPythonPath() string {
	base := getBasePath()
	python := filepath.Join(base, ".venv", "bin", "python")
	if runtime.GOOS == "windows" {
		python = filepath.Join(base, ".venv", "Scripts", "python.exe")
	}
	return python
}

func runObserver(action string, args []string) {
	python := getPythonPath()
	base := getBasePath()
	scriptPath := filepath.Join(base, "observer.py")
	
	fullArgs := append([]string{scriptPath, action}, args...)
	
	c := exec.Command(python, fullArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	c.Stdin = os.Stdin
	
	err := c.Run()
	if err != nil {
		os.Exit(1)
	}
}
