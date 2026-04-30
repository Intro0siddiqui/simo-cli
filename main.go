package main

import (
	"os"
	"os/exec"
	"runtime"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

var port int

func main() {
	rootCmd.Execute()
}

var rootCmd = &cobra.Command{
	Use:   "simo",
	Short: "Simo CLI — Agentic Browser Control Orchestrator",
	Long:  `A cross-platform Go wrapper for the Simo Python backend. Replacement for legacy shell scripts.`,
}

func init() {
	rootCmd.PersistentFlags().IntVarP(&port, "port", "p", 8765, "port for the relay server")

	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(statusCmd)
	
	// Dynamically wrap all other commands to observer.py
	rootCmd.AddCommand(wrapCmd("snap", "Get accessibility snapshot"))
	rootCmd.AddCommand(wrapCmd("shot", "Take screenshot"))
	rootCmd.AddCommand(wrapCmd("click", "Click element by ref"))
	rootCmd.AddCommand(wrapCmd("type", "Type text into element"))
	rootCmd.AddCommand(wrapCmd("hover", "Hover over element by ref"))
	rootCmd.AddCommand(wrapCmd("drag", "Drag element from one ref to another"))
	rootCmd.AddCommand(wrapCmd("nav", "Navigate tab to URL"))
	rootCmd.AddCommand(wrapCmd("exec", "Execute JS code"))
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the WebSocket relay server",
	Run: func(cmd *cobra.Command, args []string) {
		python := getPythonPath()
		color.Cyan("[Simo] Starting relay server on ws://127.0.0.1:%d...", port)
		
		// In Go, we can start it in a way that it keeps running
		c := exec.Command(python, "server.py")
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		
		err := c.Start()
		if err != nil {
			color.Red("Failed to start server: %v", err)
			return
		}
		
		color.Green("[Simo] Server started (PID %d).", c.Process.Pid)
		color.Yellow("Keep this terminal open or run with 'nohup' for background use.")
		c.Wait()
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

func getPythonPath() string {
	python := "./.venv/bin/python"
	if runtime.GOOS == "windows" {
		python = ".\\.venv\\Scripts\\python.exe"
	}
	return python
}

func runObserver(action string, args []string) {
	python := getPythonPath()
	fullArgs := append([]string{"observer.py", action}, args...)
	
	c := exec.Command(python, fullArgs...)
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	c.Stdin = os.Stdin
	
	err := c.Run()
	if err != nil {
		os.Exit(1)
	}
}
