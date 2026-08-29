package mc

import "testing"

func TestOfflineUUID(t *testing.T) {
	// Known value: offline UUID for "Notch".
	if got := OfflineUUID("Notch"); got != "b50ad385-829d-3141-a216-7e7d7539ba7f" {
		t.Errorf("OfflineUUID(Notch) = %s", got)
	}
	if got := DashUUID("069a79f444e94726a5befca90e38aaf5"); got != "069a79f4-44e9-4726-a5be-fca90e38aaf5" {
		t.Errorf("DashUUID = %s", got)
	}
}

func TestValidateProperty(t *testing.T) {
	if err := ValidateProperty("view-distance", "40"); err == nil {
		t.Error("expected max error")
	}
	if err := ValidateProperty("pvp", "yes"); err == nil {
		t.Error("expected bool error")
	}
	if err := ValidateProperty("difficulty", "hard"); err != nil {
		t.Error(err)
	}
	if err := ValidateProperty("server-port", "1"); err == nil {
		t.Error("expected managed error")
	}
	if err := ValidateProperty("some-plugin-key", "x"); err != nil {
		t.Error("unknown keys must pass")
	}
}
