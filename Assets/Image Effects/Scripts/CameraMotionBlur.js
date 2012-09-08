
#pragma strict

@script ExecuteInEditMode
@script RequireComponent (Camera)
@script AddComponentMenu ("Image Effects/Camera Motion Blur") 

public class CameraMotionBlur extends PostEffectsBase 
{
	// make sure to match this to MAX_RADIUS in shader ('k' in paper)
	static var MAX_RADIUS : int = 8.0f;

	public enum MotionBlurFilter {
		CameraMotion = 0, // global screen blur based on cam motion
		LocalBlur = 1, // cheap blur, no dilation or scattering
		Reconstruction = 2, // advanced filter (simulates scattering) as in plausible motion blur paper
	}

	// settings		
	public var filterType : MotionBlurFilter = MotionBlurFilter.Reconstruction;	
	public var preview : boolean = false;				// show how blur would look like in action ...
	public var previewScale : Vector3 = Vector3.one;	// ... given this movement vector
	
	// params
	public var movementScale : float = 0.0f;
	public var rotationScale : float = 1.0f;
	public var maxVelocity : float = 8.0f;	// maximum velocity in pixels
	public var minVelocity : float = 0.1f;	// minimum velocity in pixels
	public var velocityScale : float = 0.375f;	// global velocity scale
	public var softZDistance : float = 0.01f;	// for soft z overlap check (reconstruction filter only)
	public var velocityDownsample : int = 1;	// low resolution velocity buffer? (optimization)
	public var excludeLayers : LayerMask = 0;
	//public var dynamicLayers : LayerMask = 0;
	private var tmpCam : GameObject = null;

	// resources
	public var shader : Shader;
	public var replacementClear : Shader;
	//public var replacementDynamics : Shader;
	private var motionBlurMaterial : Material = null;
	public var noiseTexture : Texture2D = null;	

	// (internal) debug
	public var showVelocity : boolean = false;
	public var showVelocityScale : float = 1.0f;	
	
	// camera transforms
	private var currentViewProjMat : Matrix4x4;
	private var prevViewProjMat : Matrix4x4;
	private var prevFrameCount : int;
	private var wasActive : boolean;
	// shortcuts to calculate global blur direction when using 'CameraMotion'
	private var prevFrameForward : Vector3 = Vector3.forward;            	            	            	            	            	            	            	            	            	            	            	            	            	            	            	
	private var prevFrameRight : Vector3 = Vector3.right;            	            	            	            	            	            	            	            	            	            	            	            	            	            	            	
	private var prevFrameUp : Vector3 = Vector3.up;       
	private var prevFramePos : Vector3 = Vector3.zero;     	 

	private function PrepareCameraTransform() {
		var viewMat : Matrix4x4 = camera.worldToCameraMatrix;
		var projMat : Matrix4x4 = GL.GetGPUProjectionMatrix (camera.projectionMatrix, true);
		currentViewProjMat = projMat * viewMat;				
	}
	
	function Start ()
	{
		CheckResources ();

		wasActive = gameObject.activeInHierarchy;
		PrepareCameraTransform ();
		Remember ();
		prevFrameCount = -1;
		wasActive = false; // hack to fake position/rotation update and prevent bad blurs
	}

	function OnEnable () {
		camera.depthTextureMode |= DepthTextureMode.Depth;	
	}
		
	function OnDisable () {
		if (null != motionBlurMaterial) {
			DestroyImmediate (motionBlurMaterial);
			motionBlurMaterial = null;
		}
		if (null != tmpCam) {
			DestroyImmediate (tmpCam);
			tmpCam = null;
		}
	}

	function CheckResources () : boolean {
		CheckSupport (true, true); // depth & hdr needed
		motionBlurMaterial = CheckShaderAndCreateMaterial (shader, motionBlurMaterial); 
	
		if(!isSupported)
			ReportAutoDisable ();

		return isSupported;			
	}		
	
	function OnRenderImage(source : RenderTexture, destination : RenderTexture) {	
		if (false == CheckResources ()) {
			Graphics.Blit (source, destination);
			return;
		}

		if (filterType == MotionBlurFilter.CameraMotion)
			StartFrame ();

		// use if possible new RG format ... fallback to traditional half otherwise
		var rtFormat = SystemInfo.SupportsRenderTextureFormat (RenderTextureFormat.RGHalf) ? RenderTextureFormat.RGHalf : RenderTextureFormat.ARGBHalf;

		// get temp textures
		var velBuffer : RenderTexture = RenderTexture.GetTemporary (divRoundUp (source.width, velocityDownsample), divRoundUp (source.height, velocityDownsample), 0, rtFormat);
		var tileWidth : int = divRoundUp(velBuffer.width, MAX_RADIUS);
		var tileHeight : int = divRoundUp(velBuffer.height, MAX_RADIUS);		
		var tileMax : RenderTexture  = RenderTexture.GetTemporary(tileWidth, tileHeight, 0, rtFormat);
		var neighbourMax : RenderTexture  = RenderTexture.GetTemporary(tileWidth, tileHeight, 0, rtFormat);
		velBuffer.filterMode = FilterMode.Point;		
		tileMax.filterMode = FilterMode.Point;
		neighbourMax.filterMode = FilterMode.Point;

		// calc correct viewprj matrix
		PrepareCameraTransform ();

		// just started up?		
		if (gameObject.activeInHierarchy && !wasActive) {
			Remember ();		
		}
		wasActive = gameObject.activeInHierarchy;
		
		// matrices
		var invViewPrj : Matrix4x4 = Matrix4x4.Inverse(currentViewProjMat);
		motionBlurMaterial.SetMatrix ("_InvViewProj", invViewPrj);
		motionBlurMaterial.SetMatrix ("_PrevViewProj", prevViewProjMat);
		motionBlurMaterial.SetMatrix ("_ToPrevViewProjCombined", prevViewProjMat * invViewPrj);		
		
		// clamp reconstruction filter to not sample out of bounds
		if (filterType == MotionBlurFilter.Reconstruction && (maxVelocity > MAX_RADIUS))
			maxVelocity = MAX_RADIUS;

		motionBlurMaterial.SetFloat ("_MaxVelocity", maxVelocity);
		motionBlurMaterial.SetFloat ("_MinVelocity", minVelocity);
		motionBlurMaterial.SetFloat ("_VelocityScale", velocityScale);
		
		// texture samplers
		motionBlurMaterial.SetTexture ("_NoiseTex", noiseTexture);
		motionBlurMaterial.SetTexture ("_VelTex", velBuffer);
		motionBlurMaterial.SetTexture ("_NeighbourMaxTex", neighbourMax);
		
		// texture resolutions
		motionBlurMaterial.SetVector ("_VelBufferSize", Vector4(velBuffer.width, velBuffer.height, 1.0f / (1.0f*velBuffer.width), 1.0f / (1.0f*velBuffer.height)));
		motionBlurMaterial.SetVector ("_TileBufferSize", Vector4(tileMax.width, tileMax.height, 1.0f / (1.0f*tileMax.width), 1.0f / (1.0f*tileMax.height)));

		if (preview) {
			// generate an artifical 'previous' matrix to simulate blur look
			var viewMat : Matrix4x4 = camera.worldToCameraMatrix;
			var offset : Matrix4x4 = Matrix4x4.identity;
			offset.SetTRS(previewScale * 0.25f, Quaternion.identity, Vector3.one);
			var projMat : Matrix4x4 = GL.GetGPUProjectionMatrix (camera.projectionMatrix, true);
			prevViewProjMat = projMat * viewMat * offset;
			motionBlurMaterial.SetMatrix("_PrevViewProj", prevViewProjMat);
		}

		if (filterType == MotionBlurFilter.CameraMotion)
		{
			// build blur vector to be used in shader to create a global blur direction
			var blurVector : Vector4 = Vector4.zero;

			var lookUpDown : float = Vector3.Dot(transform.up, Vector3.up);
			var distanceVector : Vector3 = prevFramePos-transform.position;

			var distMag : float = distanceVector.magnitude;

			var farHeur : float = 1.0f;

			// pitch (vertical)
			farHeur = (Vector3.Angle(transform.up, prevFrameUp) / camera.fieldOfView) * (source.width * 0.75f);
			blurVector.x =  rotationScale * farHeur;//Mathf.Clamp01((1.0f-Vector3.Dot(transform.up, prevFrameUp)));

			// yaw #1 (horizontal, faded by pitch)
			farHeur = (Vector3.Angle(transform.forward, prevFrameForward) / camera.fieldOfView) * (source.width * 0.75f);
			blurVector.y = rotationScale * lookUpDown * farHeur;//Mathf.Clamp01((1.0f-Vector3.Dot(transform.forward, prevFrameForward)));

			// yaw #2 (when looking down, faded by 1-pitch)
			farHeur = (Vector3.Angle(transform.forward, prevFrameForward) / camera.fieldOfView) * (source.width * 0.75f);			
			blurVector.z = rotationScale * (1.0f- lookUpDown) * farHeur;//Mathf.Clamp01((1.0f-Vector3.Dot(transform.forward, prevFrameForward)));

			if (distMag > Mathf.Epsilon && movementScale > Mathf.Epsilon) {
				// forward (probably most important)
				blurVector.w = movementScale * Mathf.Clamp01(Vector3.Dot(transform.forward, distanceVector)) * (source.width * 0.5f);
				// jump (maybe scale down further)
				blurVector.x += movementScale * Mathf.Clamp01(Vector3.Dot(transform.up, distanceVector)) * (source.width * 0.5f);
				// strafe (maybe scale down further)
				blurVector.y += movementScale * Mathf.Clamp01(Vector3.Dot(transform.right, distanceVector)) * (source.width * 0.5f);
			}

			if (preview) // crude approximation
				motionBlurMaterial.SetVector ("_BlurDirectionPacked", Vector4 (previewScale.y, previewScale.x, 0.0f, previewScale.z) * 0.5f * camera.fieldOfView);
			else
				motionBlurMaterial.SetVector ("_BlurDirectionPacked", blurVector);
		}
		else {		
			// generate velocity buffer	
			Graphics.Blit (source, velBuffer, motionBlurMaterial, 0);

			// patch up velocity buffer

			// exclude certain layers (e.g. skinned objects as we cant really support that atm)

			var cam : Camera = null;
			if (excludeLayers.value)// || dynamicLayers.value)
				cam = GetTmpCam ();
	
			if (cam && excludeLayers.value != 0 && replacementClear && replacementClear.isSupported) {
				cam.targetTexture = velBuffer;				
				cam.cullingMask = excludeLayers;
				cam.RenderWithShader (replacementClear, "");
			}
			
			// dynamic layers (e.g. rigid bodies)
			// no worky in 4.0, but let's fix for 4.x
			/*
			if (cam && dynamicLayers.value != 0 && replacementDynamics && replacementDynamics.isSupported) {

				Shader.SetGlobalFloat ("_MaxVelocity", maxVelocity);
				Shader.SetGlobalFloat ("_VelocityScale", velocityScale);
				Shader.SetGlobalVector ("_VelBufferSize", Vector4 (velBuffer.width, velBuffer.height, 0, 0));
				Shader.SetGlobalMatrix ("_PrevViewProj", prevViewProjMat);
				Shader.SetGlobalMatrix ("_ViewProj", currentViewProjMat);

				cam.targetTexture = velBuffer;				
				cam.cullingMask = dynamicLayers;
				cam.RenderWithShader (replacementDynamics, "");
			}
			*/
			
		}

		if (!preview && Time.frameCount != prevFrameCount) {
			// remember current transformation data for next frame
			prevFrameCount = Time.frameCount;
			Remember ();
		}		
		
		if (showVelocity) {
			// render debug info (velocity vector), scale if needed
			motionBlurMaterial.SetFloat ("_DisplayVelocityScale", showVelocityScale);
			Graphics.Blit (velBuffer, destination, motionBlurMaterial, 1);
		} 
		else {
			if (filterType == MotionBlurFilter.Reconstruction) {
				// 'reconstructing' properly integrated color
				motionBlurMaterial.SetFloat ("_SoftZDistance", Mathf.Max(0.001f, softZDistance) );
				
				// generate tile max and neighbour max		
				Graphics.Blit (velBuffer, tileMax, motionBlurMaterial, 2);
				Graphics.Blit (tileMax, neighbourMax, motionBlurMaterial, 3);
				
				// final blur
				Graphics.Blit (source, destination, motionBlurMaterial, 4);
			} 
			else if (filterType == MotionBlurFilter.CameraMotion)
			{
				Graphics.Blit (source, destination, motionBlurMaterial, 6);				
			}
			else {
				// simple blur, blurring along velocity (gather)
				Graphics.Blit (source, destination, motionBlurMaterial, 5);
			}
		}
		
		// cleanup
		RenderTexture.ReleaseTemporary (velBuffer);
		RenderTexture.ReleaseTemporary (tileMax);
		RenderTexture.ReleaseTemporary (neighbourMax);
	}

	function Remember () {
		prevViewProjMat = currentViewProjMat;
		prevFrameForward = transform.forward;
		prevFrameRight = transform.right;
		prevFrameUp = transform.up;
		prevFramePos = transform.position;			
	}

	function GetTmpCam () : Camera {
		if (tmpCam == null) {
			var name : String = "_" + camera.name + "_MotionBlurTmpCam";
			var go : GameObject = GameObject.Find (name);
			if (null == go) // couldn't find, recreate
				tmpCam = new GameObject (name, typeof (Camera));
			else
				tmpCam = go;
		}

		tmpCam.hideFlags = HideFlags.DontSave;
		tmpCam.transform.position = camera.transform.position;
		tmpCam.transform.rotation = camera.transform.rotation;
		tmpCam.transform.localScale = camera.transform.localScale;
		tmpCam.camera.CopyFrom (camera);

		tmpCam.camera.enabled = false;
		tmpCam.camera.depthTextureMode = DepthTextureMode.None;
		tmpCam.camera.clearFlags = CameraClearFlags.Nothing;

		return tmpCam.camera;
	}

	function StartFrame () {
		// take only 25% of positional changes into account (camera motion)
		// TODO: possibly do the same for rotational part
		prevFramePos = Vector3.Slerp(prevFramePos, transform.position, 0.75f);
	}
			
	function divRoundUp (x : int, d : int) : int {
		return (x + d - 1) / d;
	}
}
