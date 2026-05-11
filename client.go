package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"time"

	"github.com/fatih/color"
	"github.com/gorilla/websocket"
)

const TIMEOUT = 60 * time.Second

func sendCommand(port int, msg map[string]interface{}) (map[string]interface{}, error) {
	uri := fmt.Sprintf("ws://127.0.0.1:%d", port)
	conn, _, err := websocket.DefaultDialer.Dial(uri, nil)
	if err != nil {
		return nil, fmt.Errorf("relay server not running. (Run ./simo serve): %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(msg); err != nil {
		return nil, fmt.Errorf("failed to send message: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(TIMEOUT))
	_, message, err := conn.ReadMessage()
	if err != nil {
		return nil, fmt.Errorf("operation timed out or failed to read: %v", err)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(message, &data); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	if errMsg, ok := data["error"].(string); ok {
		return nil, fmt.Errorf("%s", errMsg)
	}

	return data, nil
}

func renderTabs(data map[string]interface{}) {
	tabsRaw, ok := data["tabs"].([]interface{})
	if !ok {
		tabsRaw = []interface{}{}
	}
	
	fmt.Printf("\n%s\n\n", color.New(color.Bold).Sprintf("Active Tabs (%d)", len(tabsRaw)))
	
	for _, raw := range tabsRaw {
		tab, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		
		id := int(tab["id"].(float64))
		title := tab["title"].(string)
		url := tab["url"].(string)
		active := tab["active"].(bool)

		marker := color.New(color.Faint).Sprint("○")
		if active {
			marker = color.New(color.FgYellow).Sprint("●")
		}

		idStr := color.New(color.Bold).Sprintf("%d", id)
		urlStr := color.New(color.Faint).Sprint(url)

		fmt.Printf("  %s  %s - %s\n", marker, idStr, title)
		fmt.Printf("      %s\n", urlStr)
	}
	fmt.Println()
}

func renderSnapshot(snapshot string) {
	fmt.Printf("\n%s\n", color.New(color.Bold).Sprint("Accessibility Tree Snapshot"))
	
	reRef := regexp.MustCompile(`\[ref=(e\d+)\]`)
	snapshot = reRef.ReplaceAllString(snapshot, "["+color.New(color.FgYellow).Sprint("$1")+"]")
	
	reBox := regexp.MustCompile(`\[box=([\d,]+)\]`)
	snapshot = reBox.ReplaceAllString(snapshot, "["+color.New(color.FgBlue).Sprint("box=$1")+"]")
	
	fmt.Println(snapshot)
}

func runClientStatus(port int, isJSON bool) {
	data, err := sendCommand(port, map[string]interface{}{"type": "query"})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	
	if isJSON {
		bytes, _ := json.MarshalIndent(data, "", "  ")
		fmt.Println(string(bytes))
	} else {
		renderTabs(data)
	}
}

func runClientNav(port int, tabId int, url string) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "navigate", "tabId": tabId, "url": url,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Navigating...\n")
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientOpen(port int, url string) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "new_tab", "url": url,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Opening new tab: %s\n", url)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientSnap(port int, tabId int, ref string, interactiveOnly bool) {
	msg := map[string]interface{}{
		"type": "action", "action": "snapshot", "tabId": tabId, "interactiveOnly": interactiveOnly,
	}
	if ref != "" {
		msg["ref"] = ref
	}
	res, err := sendCommand(port, msg)
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		renderSnapshot(res["snapshot"].(string))
		color.New(color.Faint).Println("(Note: Captured via CDP)")
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientWaitText(port int, tabId int, text string, timeout int) {
	color.Blue("Waiting for text '%s'...\n", text)
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "wait_text", "tabId": tabId, "text": text, "timeout": timeout,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Text '%s' found in the accessibility tree.\n", text)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientWait(port int, tabId int, ref string, timeout int) {
	color.Blue("Waiting for %s...\n", ref)
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "wait", "tabId": tabId, "ref": ref, "timeout": timeout,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Element %s is now actionable.\n", ref)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientClick(port int, tabId int, ref string, wait bool, verify bool) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "click", "tabId": tabId, "ref": ref, "wait": wait, "verify": verify,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	switch res["status"] {
	case "success":
		color.Green("Click dispatched to %s\n", ref)
	case "warning":
		color.Yellow("Warning: Click sent but verification failed (state didn't change).\n")
	default:
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientGrid(port int, tabId int, gridRef string, columnQuery string) {
	color.Blue("Executing Grid-Strike on %s targeting '%s'...\n", gridRef, columnQuery)
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "grid_strike", "tabId": tabId, "gridRef": gridRef, "columnQuery": columnQuery,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Grid Strike complete! Clicked %v rows.\n", res["clicked"])
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientScroll(port int, tabId int, delta int, ref string) {
	msg := map[string]interface{}{
		"type": "action", "action": "scroll", "tabId": tabId, "delta": delta,
	}
	if ref != "" {
		msg["ref"] = ref
	}
	res, err := sendCommand(port, msg)
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Scrolled %d px\n", delta)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientDrag(port int, tabId int, fromRef string, toRef string) {
	_, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "drag", "tabId": tabId, "from": fromRef, "to": toRef,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	} else {
		color.Green("Drag dispatched from %s to %s\n", fromRef, toRef)
	}
}

func runClientHover(port int, tabId int, ref string, wait bool) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "hover", "tabId": tabId, "ref": ref, "wait": wait,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		color.Green("Hover dispatched to %s\n", ref)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}

func runClientRawClick(port int, tabId int, x int, y int) {
	_, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "raw_click", "tabId": tabId, "x": x, "y": y,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	} else {
		color.Green("Raw click dispatched to %d, %d\n", x, y)
	}
}

func runClientType(port int, tabId int, ref string, text string, wait bool) {
	_, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "type", "tabId": tabId, "ref": ref, "text": text, "wait": wait,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	} else {
		color.Green("Typed into %s: \"%s\"\n", ref, text)
	}
}

func runClientExec(port int, tabId int, code string) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "execute", "tabId": tabId, "code": code,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	bytes, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(bytes))
}

func runClientShot(port int, tabId int, output string) {
	res, err := sendCommand(port, map[string]interface{}{
		"type": "action", "action": "screenshot", "tabId": tabId,
	})
	if err != nil {
		color.Red("Error: %v\n", err)
		os.Exit(1)
	}
	if res["status"] == "success" {
		data, _ := base64.StdEncoding.DecodeString(res["data"].(string))
		os.WriteFile(output, data, 0644)
		color.Green("Screenshot saved to %s\n", output)
	} else {
		color.Red("Error: %v\n", res["message"])
	}
}
