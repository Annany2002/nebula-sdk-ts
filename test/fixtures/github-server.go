// Overlaid only for isolated OAuth contracts. Never compiled into production or shipped in npm.
package main

import (
	"context"
	"errors"
	"net"
	"os"
	"sync"

	"github.com/Annany2002/nebula-backend/api"
	"github.com/Annany2002/nebula-backend/config"
	"github.com/Annany2002/nebula-backend/internal/githubauth"
	"github.com/Annany2002/nebula-backend/internal/storage"
	"github.com/gin-gonic/gin"
)

type provider struct {
	sync.Mutex
	calls int
}

func (p *provider) Exchange(_ context.Context, code, _ string) (githubauth.Profile, error) {
	p.Lock()
	p.calls++
	p.Unlock()
	switch code {
	case "new":
		return githubauth.Profile{Subject: "100", Login: "octocat", Email: "github-new@example.test"}, nil
	case "existing-email":
		return githubauth.Profile{Subject: "200", Login: "linked", Email: "sdk-owner@example.test"}, nil
	case "unverified":
		return githubauth.Profile{}, githubauth.ErrVerifiedEmail
	default:
		return githubauth.Profile{}, errors.New("fixture upstream failure")
	}
}

type noMail struct{}

func (noMail) Send(context.Context, string, string, string) error {
	return errors.New("mail is disabled in the OAuth fixture")
}
func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		panic(err)
	}
	cfg.GitHub = config.GitHubConfig{Enabled: true, ClientID: "fixture-client", ClientSecret: "fixture-secret", RedirectURL: "http://localhost:3000/auth/github/callback"}
	db, err := storage.ConnectMetadataDB(cfg)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	p := &provider{}
	router := api.SetupRouterWithAuthProviders(db, cfg, noMail{}, p)
	router.GET("/__test/provider-calls", func(c *gin.Context) { p.Lock(); defer p.Unlock(); c.JSON(200, gin.H{"calls": p.calls}) })
	if err := router.Run(net.JoinHostPort("127.0.0.1", cfg.ServerPort)); err != nil {
		os.Exit(1)
	}
}
