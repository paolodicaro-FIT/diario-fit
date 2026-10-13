package it.paololab3d.diariofit.activitybridge

import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateRequest
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var sendButton: Button
    private lateinit var client: HealthConnectClient
    private var steps = 0L
    private var activeKcal = 0L
    private val permissions = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    )
    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        if (granted.containsAll(permissions)) readToday()
        else status.text = "Permesso non concesso. Servono Passi e Calorie attive."
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        sendButton = findViewById(R.id.sendButton)
        client = HealthConnectClient.getOrCreate(this)
        findViewById<Button>(R.id.importButton).setOnClickListener { ensurePermissionThenRead() }
        sendButton.setOnClickListener { openDiarioFitTest() }
        checkAvailability()
    }
    private fun checkAvailability() {
        status.text = when (HealthConnectClient.getSdkStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE -> "Health Connect disponibile. Premi “Leggi da Health Connect”."
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "Aggiorna Health Connect, poi riapri questa app."
            else -> "Health Connect non è disponibile su questo telefono."
        }
    }
    private fun ensurePermissionThenRead() {
        CoroutineScope(Dispatchers.Main).launch {
            if (client.permissionController.getGrantedPermissions().containsAll(permissions)) readToday()
            else permissionLauncher.launch(permissions)
        }
    }
    private fun readToday() {
        status.text = "Lettura dei dati di oggi…"
        sendButton.isEnabled = false
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val zone = ZoneId.systemDefault()
                val start = LocalDate.now(zone).atStartOfDay(zone).toInstant()
                val result = client.aggregate(AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(start, Instant.now())
                ))
                steps = result[StepsRecord.COUNT_TOTAL] ?: 0L
                activeKcal = kotlin.math.round(result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories ?: 0.0).toLong()
                withContext(Dispatchers.Main) {
                    status.text = "Dati letti: $steps passi · $activeKcal kcal attive."
                    sendButton.isEnabled = true
                }
            } catch (error: Exception) {
                withContext(Dispatchers.Main) {
                    status.text = "Non riesco a leggere Health Connect."
                }
            }
        }
    }
    private fun openDiarioFitTest() {
        val url = Uri.parse("https://paolodicaro-fit.github.io/diario-fit/TEST.html").buildUpon()
            .appendQueryParameter("dfBridge", "healthconnect")
            .appendQueryParameter("steps", steps.toString())
            .appendQueryParameter("activeKcal", activeKcal.toString())
            .build()
        CustomTabsIntent.Builder().build().launchUrl(this, url)
    }
}
