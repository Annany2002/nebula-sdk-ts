// This entrypoint is overlaid onto cmd/server/main.go only for isolated SDK tests.
// It is never compiled into the production backend or included in the npm package.
package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/Annany2002/nebula-backend/api"
	"github.com/Annany2002/nebula-backend/config"
	"github.com/Annany2002/nebula-backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type capturedMail struct {
	To   string `json:"to"`
	Body string `json:"body"`
}
type mailbox struct {
	sync.Mutex
	messages []capturedMail
	failure  bool
}

func (m *mailbox) Send(_ context.Context, to, _ string, body string) error {
	m.Lock()
	defer m.Unlock()
	if m.failure {
		return errors.New("fixture delivery failure")
	}
	m.messages = append(m.messages, capturedMail{to, body})
	return nil
}
func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		panic(err)
	}
	cfg.Email.Enabled = true
	cfg.Email.AppURL = "http://localhost:3000"
	cfg.Email.TokenTTL = 30 * time.Minute
	db, err := storage.ConnectMetadataDB(cfg)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	sender := &mailbox{messages: []capturedMail{}}
	router := api.SetupRouterWithEmailSender(db, cfg, sender)
	router.GET("/__test/messages", func(c *gin.Context) { sender.Lock(); defer sender.Unlock(); c.JSON(http.StatusOK, sender.messages) })
	router.PUT("/__test/mail-failure", func(c *gin.Context) {
		var input struct {
			Failure bool `json:"failure"`
		}
		if c.ShouldBindJSON(&input) != nil {
			c.Status(400)
			return
		}
		sender.Lock()
		sender.failure = input.Failure
		sender.Unlock()
		c.Status(204)
	})
	// Advance only the send timestamp in disposable test data; production rate-limit code is unchanged.
	router.POST("/__test/expire-send-cooldown", func(c *gin.Context) {
		var input struct {
			Email string `json:"email"`
		}
		if c.ShouldBindJSON(&input) != nil {
			c.Status(400)
			return
		}
		_, err := db.ExecContext(c.Request.Context(), `UPDATE email_send_limits SET last_requested_at=last_requested_at-61 WHERE user_id=(SELECT user_id FROM users WHERE email=?)`, input.Email)
		if err != nil {
			c.Status(500)
			return
		}
		c.Status(204)
	})
	if err := router.Run(net.JoinHostPort("127.0.0.1", cfg.ServerPort)); err != nil {
		os.Exit(1)
	}
}
