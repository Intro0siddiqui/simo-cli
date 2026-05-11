package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"github.com/gorilla/websocket"
	"github.com/google/uuid"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow Chrome extension
	},
}

type RelayServer struct {
	mu              sync.Mutex
	extensionConn   *websocket.Conn
	pendingRequests map[string]*websocket.Conn
}

func NewRelayServer() *RelayServer {
	return &RelayServer{
		pendingRequests: make(map[string]*websocket.Conn),
	}
}

func (s *RelayServer) HandleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer conn.Close()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Println("Invalid JSON:", string(message))
			continue
		}

		msgType, _ := msg["type"].(string)

		if msgType == "ping" {
			continue
		}

		if msgType == "register" && msg["role"] == "extension" {
			s.mu.Lock()
			s.extensionConn = conn
			s.mu.Unlock()
			log.Println("Extension registered")
			continue
		}

		if msgType == "query" || msgType == "action" {
			s.mu.Lock()
			extConn := s.extensionConn
			s.mu.Unlock()

			if extConn == nil {
				conn.WriteJSON(map[string]string{"error": "Extension not connected"})
				continue
			}

			action, _ := msg["action"].(string)
			if msgType == "query" {
				action = "get_tabs"
			}
			if action == "" {
				conn.WriteJSON(map[string]string{"error": "No action specified"})
				continue
			}

			reqID := uuid.New().String()[:8]
			s.mu.Lock()
			s.pendingRequests[reqID] = conn
			s.mu.Unlock()

			payload := map[string]interface{}{
				"action":    action,
				"client_id": reqID,
			}
			for k, v := range msg {
				if k != "type" && k != "action" && k != "client_id" {
					payload[k] = v
				}
			}

			err = extConn.WriteJSON(payload)
			if err != nil {
				log.Println("Forwarding failed:", err)
				conn.WriteJSON(map[string]string{"error": err.Error()})
			} else {
				log.Printf("Action '%s' forwarded (id: %s)\n", action, reqID)
			}
		} else if msgType == "response" {
			clientID, _ := msg["client_id"].(string)
			s.mu.Lock()
			clientConn, exists := s.pendingRequests[clientID]
			if exists {
				delete(s.pendingRequests, clientID)
			}
			s.mu.Unlock()

			if exists {
				data := msg["data"]
				if data == nil {
					data = map[string]interface{}{}
				}
				clientConn.WriteJSON(data)
			} else {
				log.Printf("Stale response received (client id: %s)\n", clientID)
			}
		}
	}

	s.mu.Lock()
	if s.extensionConn == conn {
		s.extensionConn = nil
		log.Println("Extension unregistered")
	} else {
		// Clean up any pending requests if client disconnects early
		for id, pending := range s.pendingRequests {
			if pending == conn {
				delete(s.pendingRequests, id)
			}
		}
	}
	s.mu.Unlock()
}

func startServer(port int) {
	relay := NewRelayServer()
	http.HandleFunc("/", relay.HandleConnection)
	addr := fmt.Sprintf("0.0.0.0:%d", port)
	log.Printf("Relay listening on ws://%s\n", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
