; GateControl – NSIS Installer Script
; WireGuard-nt ist in der App eingebettet, keine externe Installation noetig

!macro customInit
	; Keine WireGuard-Pruefung mehr noetig - App installiert WireGuard automatisch
!macroend

!macro customInstall
	; Windows-Firewall-Regel fuer GateControl
	nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GateControl" dir=in action=allow program="$INSTDIR\GateControl.exe" enable=yes'
!macroend

!macro customUnInstall
	; Firewall-Regel entfernen
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl"'

	; Kill-Switch Regeln entfernen
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Block_All_Out"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Block_All_In"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_Loopback"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_WG_Endpoint"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_VPN_Subnet"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_DHCP"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_10_0_0_0_8"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_172_16_0_0_12"'
	nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GateControl_KS_Allow_LAN_192_168_0_0_16"'

	; Autostart-Eintrag entfernen
	DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GateControl"
!macroend
